# Legacy Azure data migration runbook

This procedure is for the one-time security-model adoption of existing data. It
does not delete database rows or Azure blobs. Perform it in a maintenance
window, before enabling the revised authorization rules. Do not use `drizzle
push` for this release.

## Preconditions and backup

1. Record the release commit, database server/database/schema, Azure Storage
   account and `loan-documents` container. Confirm the GitHub/Azure database
   target fingerprint check succeeds.
2. Stop writes or put the application in maintenance mode.
3. Create a PostgreSQL backup with `pg_dump` and an Azure Blob point-in-time
   recovery/versioning snapshot according to the organization's retention
   policy. Record their timestamps and immutable locations.
4. **Verify**, rather than merely create, the backups: restore the database dump
   into an isolated database, run basic table counts, and retrieve representative
   database-backed and Blob-backed PDFs. Confirm the Blob recovery point
   predates the window. Do not proceed if either verification fails.
5. Apply the reviewed, checked-in additive security migration using the manual
   workflow and exact path
   `lib/db/migrations/0037_single_firm_security_model.sql`. Inspect its SQL in
   the release commit first. Enable the destructive-change gate only after a
   reviewer confirms both the flagged statements and verified backups.

## Explicit identities and adoption file

Obtain the authoritative Entra tenant ID and bootstrap administrator **object
ID** (not email or application ID). Set `ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID` as
described in [Azure deployment security](azure-deployment-security.md), but do
not expose the application yet.

Create a restricted local JSON file outside source control:

```json
{
  "firm": {
    "id": "A-PREGENERATED-UUID",
    "tenantId": "THE-ENTRA-TENANT-UUID",
    "name": "THE-REVIEWED-FIRM-NAME"
  },
  "bootstrapAdmin": {
    "objectId": "THE-ADMIN-OBJECT-UUID",
    "role": "admin",
    "displayName": "Reviewed administrator",
    "email": "reviewed-address@example.com"
  },
  "adoptClientIds": ["EACH-REVIEWED-CLIENT-ID"],
  "users": [
    { "objectId": "AN-EXPLICIT-STAFF-OBJECT-ID", "role": "accountant" }
  ],
  "memberships": [
    { "clientId": "A-REVIEWED-CLIENT-ID", "objectId": "THE-ADMIN-OBJECT-UUID" },
    { "clientId": "A-REVIEWED-CLIENT-ID", "objectId": "AN-EXPLICIT-STAFF-OBJECT-ID" }
  ]
}
```

The firm ID, every adopted client, user role, and membership must be approved
explicitly. Include the bootstrap administrator in each client they must verify
or manage; administrator role alone does not imply client access. The tool will
not infer staff access. An empty `users` and `memberships` list is valid; assign
staff later through the administrator API.
Never add a client merely to make a dry-run pass—resolve it against source
records first.

## Exact execution order

Run all commands from the reviewed release commit with `DATABASE_URL` pointing
to the verified target. Set `AZURE_STORAGE_CONNECTION_STRING` when inventory
shows Azure documents. Reports use exclusive creation and will not overwrite an
earlier audit artifact.

```sh
pnpm --dir scripts legacy-data inventory \
  --json audit/inventory.json --human audit/inventory.txt

pnpm --dir scripts legacy-data dry-run --config /secure/adoption.json \
  --json audit/dry-run.json --human audit/dry-run.txt
```

Review both formats. The dry-run must exit zero and report `SAFE`; document
counts, reference counts, client IDs, backends, and mappings must agree with the
approved inventory. Resolve every missing file/client/document, ambiguous raw
Blob locator, conflicting owner, malformed reference, unselected client, and
unreadable database/Blob object before continuing.

Then execute:

```sh
pnpm --dir scripts legacy-data migrate --config /secure/adoption.json \
  --json audit/migration.json --human audit/migration.txt
```

The migrate command requires both report paths and reserves them before any
database work. It writes and fsyncs the complete JSON and human reconciliation
reports after final verification but **before** commit; a report-write failure
therefore rolls back all database changes. The command reads every document
before writes, repeats verification inside one repeatable-read transaction,
and takes write-blocking/read-permitting table locks across all migration
tables so relationships cannot change mid-run. It adopts only listed clients,
creates only listed identities/memberships, backfills ownership, and changes
loan/master references to opaque `doc:<uuid>` handles. It preserves each
document's database or Azure backend. Any failure rolls back all database
changes. It never deletes rows or blobs.

Finally rerun dry-run with new report names. A second migration run is permitted
and must make no further logical changes.

## Release validation and rollback criteria

Before enabling traffic, compare the before/after reconciliation: clients,
files, loans, master agreements, stored documents, and source-reference totals
must be unchanged; all references must map uniquely; all bytes must remain
readable. Verify the bootstrap admin can authenticate, each adopted client is
visible only to the approved admin/staff memberships, unassigned staff cannot
access it, and representative database- and Azure-backed PDFs download through
their opaque handles.

Keep traffic disabled and roll back if the tool exits nonzero, any count
changes, a report has findings, a PDF cannot be retrieved, ownership differs
from the approved file-to-client chain, or authorization tests fail. A
migration-command failure needs no data rollback because its transaction has
already rolled back. For a failure discovered after commit, keep the new app
disabled, preserve the reports and logs, restore the verified PostgreSQL backup
to a separately named database, validate it, repoint only under the incident
change procedure, and use Blob recovery only if independent validation proves
Blob data changed. The migration itself never changes Blob objects.