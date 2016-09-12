// Copyright (c) Microsoft Corporation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

'use strict';

const async = require('async');
const fs = require('fs');
const path = require('path');
const os = require('os');
const isWindows = os.platform() === 'win32';

let references = null;
let interop = null;

function prepareReferences(callback) {
  if (!isWindows || references) {
    return callback();
  }
  const netfxPackages = require('./netfxPackages');

  references = [
    'System.Runtime.dll',
    'System.Threading.Tasks.dll',
  ];

  async.forEachOf(netfxPackages, (version, id, next) => {
    const assembliesDirectory = path.resolve(__dirname, `${id}.${version}`, 'lib', 'net45');
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
    const csharp = path.join(__dirname, 'interop.cs');

    interop = {
      getCertificates: createInteropFunction(edge, csharp, 'GetCertificates'),
      getAuthenticationToken: createInteropFunction(edge, csharp, 'GetAuthenticationToken'),
    };

    return callback(null, interop);   
  });
}

module.exports.addAppServiceCertificateSupport = function patchAdal(adal) { 
  const AuthenticationContext = adal.AuthenticationContext;
  
  /**
   * Gets a new access token using via a certificate credential.
   * @param  {string}   resource                            A URI that identifies the resource for which the token is valid.
   * @param  {string}   clientId                            The OAuth client id of the calling application.
   * @param  {string}   thumbprint                          A hex encoded thumbprint of the certificate.
   * @param  {AcquireTokenCallback}   callback              The callback function.
   */
  AuthenticationContext.prototype.acquireTokenWithAppServiceCertificate = (resource, clientId, thumbprint, callback) => {
    ensureInterop((buildError, ops) => {
      if (buildError) {
        return callback(buildError);
      }
      const options = {
        tenantId: 'tbd',
        clientId: clientId,
        resource: resource,
        thumbprints: thumbprint,
        allowTestCertificates: true,
      };
      ops.getAuthenticationToken(options, callback);
    });
  };

  return adal;
};
