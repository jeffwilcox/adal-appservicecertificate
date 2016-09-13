// Copyright (c) Microsoft Corporation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

'use strict';

const async = require('async');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TokenRequest = require('adal-node/lib/token-request');

const isWindows = os.platform() === 'win32';

let references = null;
let interop = null;

function prepareReferences(callback) {
  if (!isWindows || references) {
    return callback();
  }
  const nugetPackages = require('../src/nugetPackages');

  references = [
    'System.Runtime.dll',
    'System.Threading.Tasks.dll',
  ];

  async.forEachOf(nugetPackages, (version, id, next) => {
    const assembliesDirectory = path.resolve(__dirname, '..', 'packages', `${id}.${version}`, 'lib', 'net45');
    fs.readdir(assembliesDirectory, (readError, files) => {
      if (readError) {
        return next(readError);
      }
      files.forEach((file) => {
        if (path.extname(file) === '.dll') {
          references.push(path.join(assembliesDirectory, file));
        }
      });
      next();
    })
  }, (error) => {
    if (error) return callback(error);
    callback(null, references);
  });
}

function createInteropFunction(edge, sourceFile, methodName) {
  return edge.func({
    source: sourceFile,
    methodName: methodName,
    typeName: 'Interop',
    references: references,
  });
}

function ensureInterop(callback) {
  if (!isWindows) {
    return callback(new Error('This library and its functions are Windows-specific at this time.'));
  }
  if (references && interop) {
    return callback(null, interop);
  }
  const edge = require('edge');

  prepareReferences((prepError) => {
    if (prepError) {
      return callback(prepError);
    }
    const csharp = path.resolve(__dirname, '..', 'src', 'interop.cs');

    interop = {
      getCertificates: createInteropFunction(edge, csharp, 'GetCertificates'),
      getAuthenticationToken: createInteropFunction(edge, csharp, 'GetAuthenticationToken'),
    };

    return callback(null, interop);
  });
}

module.exports.getCertificates = function getCertificates(options, callback) {
  if (typeof options === 'function' && !callback) {
    callback = options;
  }
  options = options || {};
  ensureInterop((buildError, ops) => {
    if (buildError) {
      return callback(buildError);
    }
    ops.getCertificates(options, callback);
  });
}

function translateToAdalNodeResponse(netResponse) {
  const response = {
    accessToken: netResponse.AccessToken,
    expiresIn: netResponse.ExpiresIn,
    expiresOn: netResponse.ExpiresOn,
    tokenType: netResponse.AccessTokenType,
  };
  return response;
}

module.exports.addAppServiceCertificateSupport = function patchAdal(adal) {
  const AuthenticationContext = adal.AuthenticationContext;
  if (!AuthenticationContext || !AuthenticationContext.prototype || !AuthenticationContext.prototype.acquireTokenWithClientCertificate) {
    throw new Error('Must provide an instance of the npm module node-adal to this function');
  }

  TokenRequest.prototype.getTokenWithInteropCertificate = function getTokenWithInteropCertificate(interopOperations, thumbprint, callback) {
    this._log.info(`Getting a token via app service certificate patch for thumbprint "${thumbprint}".`);
    this._getTokenWithCacheWrapper(callback, function (getTokenCompleteCallback) {
      const oauthParameters = this._createOAuthParameters('client_credentials');
      const tenantId = this._authenticationContext._authority._tenant;
      if (!tenantId) {
        return callback(new Error('A tenant must be configured in the authentication context.'));
      }
      const parameters = {
        tenantId: tenantId,
        clientId: oauthParameters.client_id,
        resource: oauthParameters.resource,
        thumbprints: thumbprint,

        // TODO: allowTestCertificates configuration integration
        allowTestCertificates: true,
      };
      interopOperations.getAuthenticationToken(parameters, (interopError, netResponse) => {
        if (interopError) {
          return callback(interopError);
        }
        const translatedResponse = translateToAdalNodeResponse(netResponse);
        translatedResponse.resource = oauthParameters.resource;
        getTokenCompleteCallback(null, translatedResponse);
      });
    });
  };

  /**
   * Gets a new access token using via a certificate credential.
   * @param  {string}   resource                            A URI that identifies the resource for which the token is valid.
   * @param  {string}   clientId                            The OAuth client id of the calling application.
   * @param  {string}   thumbprint                          Thumbprint or thumbprints of the certificate.
   * @param  {AcquireTokenCallback}   callback              The callback function.
   */
  AuthenticationContext.prototype.acquireTokenWithAppServiceCertificate = function (resource, clientId, thumbprint, callback) {
    const self = this;
    ensureInterop((interopError, ops) => {
      if (interopError) {
        return callback(interopError);
      }
      self._acquireToken(callback, () => {
        const tokenRequest = new TokenRequest(this._callContext, this, clientId, resource);
        tokenRequest.getTokenWithInteropCertificate(ops, thumbprint, callback);
      });
    });
  };

  return adal;
};
