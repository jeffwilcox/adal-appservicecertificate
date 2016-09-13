// Copyright (c) Microsoft Corporation and contributors. All rights reserved.
// Licensed under the MIT license. See LICENSE file in the project root for details.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading.Tasks;
using Microsoft.IdentityModel.Clients.ActiveDirectory;
using AppService.CertificateServices;

public class Interop
{
    public async Task<object> GetCertificates(dynamic input)
    {
        CertificatesRepository certificates = new CertificatesRepository();
        return certificates.GetAllValid(true).Select(cert => Certificate.FromX509Certificate2(cert));
    }

    public async Task<object> GetAuthenticationToken(dynamic input)
    {
        CertificatesRepository certificates = new CertificatesRepository();
        bool allowTestCertificates = AuthenticationHelper.GetAllowTestCertificatesValue(input, true);
        string thumbprints = (string)input.thumbprints;
        string tenantId = (string)input.tenantId;
        string resource = (string)input.resource;
        string clientId = (string)input.clientId;

        LightweightAuthenticationResult result = await AuthenticationHelper.AuthorizeClient(certificates, allowTestCertificates, thumbprints, tenantId, clientId, resource);
        return result;
    }
}

namespace AppService.CertificateServices
{
    public class LightweightAuthenticationResult
    {
        private DateTimeOffset expiresOn;

        public string AccessToken { get; private set; }
        public string AccessTokenType { get; private set; }
        public DateTime ExpiresOn { get; private set; }
        public int ExpiresIn {
            get {
                TimeSpan remaining = ExpiresOn - DateTimeOffset.UtcNow;
                return (int) remaining.TotalSeconds;
            }
        }

        public LightweightAuthenticationResult(AuthenticationResult result)
        {
            AccessToken = result.AccessToken;
            AccessTokenType = result.AccessTokenType;
            expiresOn = result.ExpiresOn;
            ExpiresOn = expiresOn.UtcDateTime;
        }
    }

    public static class AuthenticationHelper
    {
        private const string MicrosoftOnlineAuthorityEndpoint = "https://login.microsoftonline.com/{0}";

        public static bool GetAllowTestCertificatesValue(dynamic input, bool defaultValue)
        {
            bool value = defaultValue;
            try
            {
                value = (bool)input.allowTestCertificates;
            }
            catch
            {
            }
            return value;
        }

        public static async Task<LightweightAuthenticationResult> AuthorizeClient(CertificatesRepository certificates, bool allowTestCertificates, string thumbprints, string tenantId, string clientId, string resource)
        {
            var cert = certificates.GetBestValidByThumbprints(thumbprints, allowTestCertificates);
            if (cert == null)
            {
                throw new InvalidOperationException("No certificates are available matching thumbprint(s): " + thumbprints);
            }

            ClientAssertionCertificate certCred = new ClientAssertionCertificate(clientId, cert);
            string authority = string.Format(CultureInfo.InvariantCulture, MicrosoftOnlineAuthorityEndpoint, tenantId);
            AuthenticationContext authContext = new AuthenticationContext(authority, true, TokenCache.DefaultShared);

            string resourceIdentifier = CreateResourceString(resource);
            AuthenticationResult result = await authContext.AcquireTokenAsync(resourceIdentifier, certCred);
            return new LightweightAuthenticationResult(result);
        }

        private static string CreateResourceString(string resource)
        {
            // Assumption:
            // Note that the Active Directory library does not take an object of type Uri,
            // but rather string. We do assume that a resource is a Uri, and if we construct
            // it, we require that it be an SSL endpoint. If that fails, it is returned
            // as-is.
            Uri resourceUri;
            if (Uri.TryCreate(resource, UriKind.Absolute, out resourceUri))
            {
                return resource;
            }

            string endpoint = string.Format(CultureInfo.InvariantCulture, "https://{0}", resource);
            if (Uri.TryCreate(endpoint, UriKind.Absolute, out resourceUri))
            {
                if (resourceUri.Scheme == Uri.UriSchemeHttps)
                {
                    return endpoint;
                }
            }
            return resource;
        }
    }

    public class CertificatesRepository
    {
        private StoreName storeName;
        private StoreLocation storeLocation;

        public CertificatesRepository()
        {
            storeName = StoreName.My;
            storeLocation = StoreLocation.CurrentUser;
        }

        public X509Certificate2 GetBestValidByThumbprints(string thumbprints, bool allowTestCertificates)
        {
            if (string.IsNullOrWhiteSpace(thumbprints))
            {
                throw new ArgumentException("At least one thumbprint must be provided.", "thumbprints");
            }

            // remove any ":" from thumbprints - openssl by default outputs separators
            var prints = thumbprints.Replace(":", "").Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);

            bool validateCertificates = !allowTestCertificates;
            X509Store store = new X509Store(storeName, storeLocation);
            try
            {
                store.Open(OpenFlags.ReadOnly);
                var certificates = store.Certificates.Find(X509FindType.FindByTimeValid, DateTime.Now, validateCertificates);
                if (prints.Length == 1)
                {
                    certificates = certificates.Find(X509FindType.FindByThumbprint, prints[0], validateCertificates);
                }
                if (certificates == null || certificates.Count == 0)
                {
                    return null;
                }
                if (certificates.Count == 1)
                {
                    return certificates[0];
                }
                var printSet = new HashSet<string>(prints);
                return certificates
                    .Cast<X509Certificate2>()
                    .Where(cert => cert.HasPrivateKey == true && printSet.Contains(cert.Thumbprint))
                    .OrderByDescending(cert => cert.NotAfter).FirstOrDefault();
            }
            finally
            {
                store.Close();
            }
        }

        public IEnumerable<X509Certificate2> GetAllValid(bool allowTestCertificates = true)
        {
            bool validateCertificates = !allowTestCertificates;
            X509Store store = new X509Store(storeName, storeLocation);
            try
            {
                store.Open(OpenFlags.ReadOnly);
                var certificates = store.Certificates.Find(X509FindType.FindByTimeValid, DateTime.Now, validateCertificates);
                if (certificates == null || certificates.Count == 0)
                {
                    return new X509Certificate2[] { };
                }
                return certificates.Cast<X509Certificate2>().ToList();
            }
            finally
            {
                store.Close();
            }
        }
    }

    // This class uses non-standard [for .NET] camelCase property casing
    // to quickly make the resulting interop values look more native.

    public class Certificate
    {
        public bool hasPrivateKey { get; private set; }
        public string issuer { get; private set; }
        public DateTime notBefore { get; private set; }
        public DateTime notAfter { get; private set; }
        public string subject { get; private set; }
        public string thumbprint { get; private set; }

        public int daysUntilExpiration
        {
            get
            {
                TimeSpan difference = notAfter.Subtract(DateTime.UtcNow);
                return (int)Math.Floor(difference.TotalDays);
            }
        }

        public static Certificate FromX509Certificate2(X509Certificate2 cert)
        {
            return new Certificate
            {
                hasPrivateKey = cert.HasPrivateKey,
                issuer = cert.Issuer,
                notAfter = cert.NotAfter,
                notBefore = cert.NotBefore,
                subject = cert.Subject,
                thumbprint = cert.Thumbprint,
            };
        }
    }
}