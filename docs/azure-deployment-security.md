# Azure deployment security

Configure App Service Easy Auth to require authentication for every request and
return `401` for unauthenticated users. Restrict the identity provider to the
intended Entra tenant and application registration; allowed users/groups are a
perimeter control, not a replacement for the application's firm and client
membership checks.

Enable the Easy Auth **token store** so it forwards
`x-ms-token-aad-id-token`. The API verifies that token's Entra JWKS signature;
it does not trust `X-MS-CLIENT-PRINCIPAL`. Set `ENTRA_TENANT_ID` and
`ENTRA_CLIENT_ID` to the exact tenant GUID and application/client ID. Do not
expose the application directly behind an untrusted proxy that can inject Easy
Auth headers. Production must set `NODE_ENV=production`; its authentication
middleware never permits the development identity in that mode. The fixed
development administrator is enabled only when `NODE_ENV=development` and a
Replit preview domain is present. Missing, misspelled, test, and staging
environment values fail closed instead of selecting the development identity.

Before sending the first production request, set
`ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID` to the exact Entra object-ID GUID of the
administrator who is allowed to initialize the deployment. Set
`NODE_ENV=production`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and this bootstrap
value before enabling traffic. The first successfully verified request must be
from that exact object ID; only then are the `Clearline` firm and first admin
created. An unset, malformed, or mismatched bootstrap value denies access
without creating a firm or user. After the first user exists, provision all
additional users through the authenticated admin API; the bootstrap value no
longer grants new identities access.

For an existing installation, complete the
[legacy Azure data migration runbook](legacy-azure-data-migration-runbook.md)
and its reconciliation before enabling these authorization rules.

Set `APP_ORIGIN` to the canonical complete HTTPS origin in production, and
`CORS_ALLOWED_ORIGINS` to any additional comma-separated complete HTTPS
origins. Origins are normalized and compared as full origins, never against
`Host` or `X-Forwarded-Host`. Browser mutation requests with a different Origin
are rejected; scheduler automation can omit Origin but must supply its
configured refresh secret.