# adal-appservicecertificate

A helper library built by a team deploying great Node.js apps on Azure App Service. This
library augments the official ADAL library but is not official nor approved by that team currently.

> A Node.js helper library for Azure Active Directory server-to-server communication using Azure App Service and certificate-based authentication.

This library uses Windows cryptography APIs and the .NET ADAL library to securely
get a token from AAD without needing access to the private key. You still must
configure the App Service to provide the certificate(s) to the application cert store.

The official `adal-node` npm package supports certificate-based server-to-server
authentication, but only when you have access to the entire private (exported) key
from the certificate.

This package augments the official `adal-node` package by adding a new `acquireTokenWithAppServiceCertificate`
method to your `AuthenticationContext` instance.

The win is that you can use Azure KeyVault from your Node.js app without having
to store an AAD app secret in a cleartext environment variable or configuration
file.

With this library + KeyVault, your app secrets can be read by your production
Azure App Service instances, but that it is non-trivial to export or access
those secrets outside of the App Service environment.

This can prevent accidents - without it, you could use a cloud environment's
client ID and secret from a development machine (perhaps meaning to reproduce a bug to fix),
get access to KeyVault secrets for the app, and accidentally break the production
environment while debugging.

## What you should know

This is a "plumbing package", using .NET inside the same process as Node/V8 (powered by Edge.js)
in order to access Windows cryptography operations and the full .NET Framework verison
of the Azure Active Directory library. Interop is used to communicate between an
app and the runtime environment. It's quick, but it's a little hacky, so yeah...

Special thanks to [Tomasz Janczuk](https://github.com/tjanczuk) for building [Edge.js](https://github.com/tjanczuk/edge)
to help enable the interop within the Node.js process.

### Designed for Azure App Service

The primary use case of this package is in applications written in Node.js and being
deployed into the Azure App Service (Web sites) environment. It may also be useful in
other scenarios, including Cloud Services and/or Virtual Machines, in situations where
you have certificates deployed to the machine, accessible to your application, but not
exportable.

### Windows-specific

This library is designed for use on 32- and 64-bit Windows with the .NET Framework 4.5+
available. The interop C# code is compiled at runtime. Although the NuGet package does not
include `edge` as a dependency, it is actually installed through a hack at install time in
order to not interrupt cross-platform application development.

It is designed to interface with the .NET X509Certificate2 object types and also the
official Azure Active Directory library for .NET. This library is downloaded at installation
time using NuGet.

NuGet needs to be available either in your path or via the `NUGET_EXE` environment
variable or else the functionality exposed by the package will not be available.

### Exported functions

This library exports only 2 functions:

- __getCertificates__: returns basic information about any available certificates (thumbprint, days until expiration, common subject name)
- __addAppServiceCertificateSupport__: patches the official `adal-node` library to add a new `acquireTokenWithAppServiceCertificate` method to `AuthenticationContext`, similar to the standard `acquireTokenWithCertificate` method minus the need to provide an encoded private key

### Installation

This package can be installed like any other; however, it does some
wacky things behind the scenes if you are on a Windows machine.

```
$ npm install adal-appservicecertificate
```

#### On Windows development environments

If you are developing using certificates available in your local store, make
sure you have `nuget.exe` in your path or set via the `NUGET_EXE` environment
variable. There is no longer inside the installer right now to try to look in
smart places if you do not provide these essentials.

By default at this time test certificates (those not signed by a root CA)
are acceptable, as the majority of Azure AD examples for application-based
server-to-server communication examples generate test certs.

The library is designed to _not fail NPM install_ by default on Windows
machines when `NUGET_EXE` is not present. This is because there is an
assumption being made: production, deployed and hosted by Azure App Service,
will be using certificates, but that your development environment likely is
not going through using certificates and is instead using simple ID/secret
pairs in alternate vaults that are for test purposes only. Or you are using
a simple story like [painless-config](https://github.com/Microsoft/painless-config) for local work.

#### On Windows production environments

In App Service production environments where you _will be using certificates_, make sure
that your deployment environment lets the install script know that it should
_fail_ if the NuGet process returns negatively.

The installer checks a npm configuration variable called `failifnugetfails`: if it is set to `1`, then
a failure of NuGet will fail the deployment so that you can investigate and keep your old
deployment as-is.

> I am considering a special scenario default: if you are in an App Service
deployment environment (defined by a web site-specific env variable), flipping
the default behavior when NuGet install fails to be a fatal error, stopping
your deployment...

The deployment will probably take 30-240 seconds depending on your instance
load, SKU and other environmental considerations. This is because of both
`edge.js` installing as well as NuGet downloading the ADAL .NET library and
any other needed dependencies at install time.

##### App Service WEBSITE_LOAD_CERTIFICATES

Within the SSL configuration for your app, you need to associate whatever
certificate(s) that you want with your app instance in the portal or via
ARM.

The final step is making them available to your application's identity.

To make a certificate available (but without exportable private key access) to
your app, you need to set an Application Setting for your App Service instance
called `WEBSITE_LOAD_CERTIFICATES`.

You can either set it to `*` ("load all of my certs") or you can set it to a
comma-separated list of thumbprints to make available to the app.


#### On Mac/Linux

On a Mac or Linux box, the install will be quick and you will find that
the functions are not available.

_Opinionated assumption: your code is using certificate-based auth at runtime
in prod but not locally - so your Mac or Linux is either not using KV or it is
using a ID/secret pair._


While there may be OS-specific functions for dealing with certificate stores
and key rings, this is a specialized environment.

My primary development is a Mac, so this module makes sure that I can
ship a secure production Node.js app - but when locally developing, I either
use an alternate configuration system, or a more simple client ID + secret
authentication story with AAD for any KeyVault operations.

## Sample code

### Patching the official library

Do this at the top of any file where you are going to need to auth with certs.

```javascript
'use strict';

const adal = require('adal-node');
const adalAppServiceCertificate = require('adal-appservicecertificate');
adalAppServiceCertificate.addAppServiceCertificateSupport(adal);
```

This pattern for patching is explicit to help with code readability vs magically extending.

### Requesting a token for a KeyVault resource

Using the configuration environment for your app (either files or Application
Settings within an Azure App Service), store the non-secrets for your app:
the tenant, client ID, etc.

```javascript
const authorityHostUrl = 'https://login.windows.net';
const tenant = process.env.AAD_TENANT_ID; // 'your-tenant-id';
const clientId = process.env.AAD_CLIENT_ID; // 'your Azure Application Directory client ID for the app';
const thumbprints = process.env.process.env.AAD_CLIENT_CERTIFICATE_THUMBPRINT ||  process.env.WEBSITE_LOAD_CERTIFICATES; // '...FBF286C04... your cert thumbprint(s) here';

const resource = 'https://vault.azure.net'; // KeyVault authorization
const authorityUrl = `${authorityHostUrl}/${tenant}`;
const context = new AuthenticationContext(authorityUrl);
context.acquireTokenWithAppServiceCertificate(resource, clientId, thumbprints, (authorizationError, result) => {
  if (authorizationError) return next(authorizationError);
  // go do interesting things with the token result
});
```

The token result object looks very much like any other ADAL node library
result:

```json
{
  "accessToken": "...eyJ0eXAiOiJKV1QiLCJhbGciOi...",
  "expiresIn": 3598,
  "expiresOn": "2016-09-13T04:26:30.258Z",
  "tokenType": "Bearer",
  "resource": "vault.azure.net",
  "isMRRT": true,
  "_clientId": "...b3f2...",
  "_authority": "https://login.windows.net/yourTenantId"
}
```

Although this code accepts multiple thumbprints, read this README to understand
how multiple comma-separated thumbprints are handled: they are not "all" used
to request tokens, but rather the "best match" certificate from the thumbprint
group is used. If you have a single thumbprint configured within your service's
`WEBSITE_LOAD_CERTIFICATES`, then the code above will always work, but if you have multiple loaded
certificates and they are not all authorized to the same key vaults, then you
will have problems as only one cert will be used for auth.

### Learn about available certificate thumbprints

Ideally you would not just pipe this back to a user, but here is a sample
Express route that would do just that...

```javascript
router.get('/certs', function (req, res, next) {
  // Authenticate this endpoint to your ops admins if you ship it
  // Only use this for debugging or learning about the APIs
  adalAppServiceCertificate.getCertificates(function (error, certs) {
    if (error) return next(error);
    res.json(certs);
  });
});
```

And the output will look similar to this, assuming I have these 3 certificates
associated with my app and also have set `WEBSITE_LOAD_CERTIFICATES` to `*`.

```json
[
  {
    "hasPrivateKey": true,
    "issuer": "CN=Your Issuer, OU=OrgUnit, O=Your Corporation, L=City, S=State, C=US",
    "notBefore": "2016-06-20T18:29:18.000Z",
    "notAfter": "2018-03-20T18:29:18.000Z",
    "subject": "CN=yourdomain.contoso.com",
    "thumbprint": "360B184B650A5ABA3147DB722157B4CFBF286C05",
    "daysUntilExpiration": 553
  },
  {
    "hasPrivateKey": true,
    "issuer": "O=Internet Widgits Pty Ltd, S=Some-State, C=AU",
    "notBefore": "2016-06-20T17:55:36.000Z",
    "notAfter": "2018-03-20T17:55:36.000Z",
    "subject": "CN=*.yourwildcard.contoso.com",
    "thumbprint": "360B184B650A5ABA3147DB722157B4CFBF286C06",
    "daysUntilExpiration": 553
  },
  {
    "hasPrivateKey": true,
    "issuer": "O=Internet Widgits Pty Ltd, S=Some-State, C=AU",
    "notBefore": "2016-08-27T22:25:15.000Z",
    "notAfter": "2017-08-27T22:25:15.000Z",
    "subject": "O=Internet Widgits Pty Ltd, S=Some-State, C=AU",
    "thumbprint": "360B184B650A5ABA3147DB722157B4CFBF286C04",
    "daysUntilExpiration": 348
  }
]
```

### Cross-platform code

#### Selecting the appropriate method for tokens

This sample creates a new KeyVault client which either uses an available,
configured/defined certificate thumbprint _or_ falls back to requiring a
client secret.

```javascript
'use strict';

const adal = require('adal-node');
const adalAppServiceCertificate = require('adal-appservicecertificate');
adalAppServiceCertificate.addAppServiceCertificateSupport(adal);

const config = {
  id: process.env.AAD_CLIENT_ID,
  thumbprint: process.env.AAD_CLIENT_CERTIFICATE_THUMBPRINT,
  secret: process.env.AAD_CLIENT_SECRET,
}

function createKeyVaultClient(config, callback) {
  const clientId = config.id;
  const clientSecret = config.secret;
  const clientThumbprint = config.thumbprint;
  if (!clientSecret && !clientThumbprint) {
    return callback(new Error('A certificate thumbprint or a secret must be provided for KeyVault.'));
  }
  const authenticator = (challenge, authCallback) => {
    const context = new adalNode.AuthenticationContext(challenge.authorization);
    const authenticationHandler = (tokenAcquisitionError, tokenResponse) => {
      if (tokenAcquisitionError) {
        return authCallback(tokenAcquisitionError);
      }
      const authorizationValue = `${tokenResponse.tokenType} ${tokenResponse.accessToken}`;
      return authCallback(null, authorizationValue);
    }
    return clientThumbprint ?
      context.acquireTokenWithAppServiceCertificate(challenge.resource, clientId, thumbprints, authenticationHandler) :
      context.acquireTokenWithClientCredentials(challenge.resource, clientId, clientSecret, authenticationHandler);
  };
  const credentials = new azureKeyVault.KeyVaultCredentials(authenticator);
  const keyVaultClient = new azureKeyVault.KeyVaultClient(credentials);
  callback(null, keyVaultClient);
}
```

For local development, consider having an independent KeyVault, AAD application,
and unique client ID and secret for the app authorized; then, in production, a
different vault, application, and the app itself should not have a secret
generated, but instead a certificate set with the AAD app.

## Notes

### Unofficial package

At this time this is an unofficial package in order to enable certificate-based
authentication in Node.js applications when using Azure Active Directory.

This is not being submitted at this time as a pull request because of its dependency on
Edge.js. This library is designed to be used primarily with Azure App Service, and so is
not built for general-purpose consumption, especially in cross-platform scenarios and
so I did not want to ship this as a change to the primary `adal-node` npm package.

### Designed to reduce honest secrets-related mistakes

The purpose of this package has been to help enable KeyVault with certificate-based auth.

It may be useful for other AAD application scenarios.

This package has been built to help reduce outages, prevent secret leaks,
and to do the right thing for compliance vs storing clear-text secrets.

The primary focus therefore is on reducing mistakes made by honest developers.

### "Thumbprints" concept: how the "best" available certificate is selected

To support rich key rotation scenarios, when a new authentication request is
made, an algorithm is used to determine which of the available thumbprint(s) to
use to get a token.

An expired certificate will never be used.

All valid tokens will be ordered by their expiration date in descending order. This
is so that, if on a given day you have 2 certificates valid that are authorized with
your vault, then the one which expires furthest from now will be selected.

The library is not able to try the multiple keys, so make sure that in a key
rotation scenario that all of your certificates are authorized with the app.

### Test certificates note

> TBD

## Governance

### License

Will be MIT

### Code of Conduct

Microsoft
