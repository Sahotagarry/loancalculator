# Deployment

The app runs on Azure App Service (`clin-loan-app`). Deployments go through
GitHub: pushing to the `main` branch of **Sahotagarry/loancalculator** triggers
the GitHub Actions workflow (`.github/workflows/deploy.yml`), which builds the
frontend and API server from source, assembles the deployment package, and
pushes it to Azure.

## One-step release

```
pnpm release
```

What it does, in order:

1. **Guard** — refuses to run if there are uncommitted source changes
   (build outputs like `dist/` are ignored), so you never deploy something
   that isn't checkpointed.
2. **Version guard** — refuses to run if the root `package.json` version is
   the same as what's already deployed. Bump it first (e.g. `1.1.0` →
   `1.2.0`) so the release is identifiable in the app header and at
   `/api/version`. Use `--allow-same-version` to override.
3. **Push safely** — syncs only the explicit source allowlist to GitHub `main`
   through the Replit GitHub connector (Git Data API). Writes run one at a time
   with a two-second default gap (`RELEASE_WRITE_SPACING_MS` may increase it).
   GitHub workflow files stay unchanged because Replit's GitHub connector does
   not request GitHub's separate `workflow` OAuth scope. Build output, exports,
   logs, and unknown files are rejected; Replit workspace metadata,
   screenshots, and attached assets are explicitly ignored and never uploaded.
4. **Verify the live database target** — schema changes are applied separately
   from an explicitly selected, reviewed, checked-in SQL migration. A normal
   push deployment never runs an interactive schema push.
5. **Verify and wait for Azure** — re-fetches the final commit and verifies its
   parent, complete recursive tree, file modes, deletions, and content hashes,
   then polls the one deploy workflow run associated with that verified commit
   every 10 seconds (5-minute deadline). The command only succeeds when the
   target verification and deployment both conclude successfully, so "the
   command succeeded" means the new version is live. On failure it
   prints the run URL and exits non-zero.

Progress is visible at <https://github.com/Sahotagarry/loancalculator/actions>.

### Interrupted releases and security cooldowns

Completed blob, tree, commit, branch, verification, and workflow stages are
written atomically to a credential-free checkpoint inside `.git/`. Re-running
the command resumes only when the local commit, manifest, base tree, and current
remote branch are compatible. Branch drift or a stale checkpoint stops the
release instead of guessing.

GitHub writes are never automatically retried. Ambiguous writes are reconciled
with GitHub before continuing. If Replit's or Cloudflare's security layer
returns a block page (including an HTML 403/429/503), the release circuit opens
immediately and all later writes stop. **Do not retry after a security block**:
retries can prolong the cooldown. Wait for the cooldown to expire, then run the
same command once; its checkpoint will safely resume completed work.

## Versioning

The app version lives in the root `package.json` (single source of truth).
It is baked into both builds at build time: shown next to the logo in the app
header and served at `GET /api/version`.

## Database schema changes

Schema changes are not inferred or blanket-approved during deployment. The
deployment workflow and the manual **Create database tables**
workflow (`.github/workflows/db-push.yml`) both compare the GitHub
`DATABASE_URL` secret to the `DATABASE_URL` in the live Azure App Service
environment before they do any work. The comparison uses a one-way fingerprint
of the host, port, database, connection role, and `public` schema; the live
connection string never leaves Azure and neither workflow prints credentials.
The workflow also connects before the push and confirms that the role's
effective PostgreSQL schema is `public`. Schema/search-path overrides are
rejected.

For any release that adds, renames, or otherwise requires a database column:

1. Make the schema change additive and backward-compatible with the currently
   deployed application. For a rename or removal, use an expand/contract
   sequence across separate releases rather than dropping what the live
   version still reads.
2. Review the exact checked-in SQL. Run the manual workflow with its
   `lib/db/migrations/NNNN_name.sql` path. Potentially destructive SQL is
   rejected unless the reviewer deliberately enables its backup-confirmation
   gate.
3. Verify the schema, then bump the root version, checkpoint the code, and run
   `pnpm release`. A normal push only verifies the target and deploys code.

The manual **Create database tables** workflow remains available when an
additive schema needs to be applied ahead of an application release. Run it
from the target commit; it performs the same before/after target checks.

For adoption of pre-security-model clients and documents, follow the
[legacy Azure data migration runbook](docs/legacy-azure-data-migration-runbook.md)
before deploying authorization-dependent code.

If either check reports a target mismatch, do not deploy or retry the push.
Correct the GitHub `DATABASE_URL` secret or Azure App Service `DATABASE_URL`
setting so they point to the same PostgreSQL database and `public` schema. The
Kudu command endpoint and SCM basic authentication must remain available to
the publish profile used by the workflows.

## Notes

- Plain `git push` does not work with the Replit GitHub connection (its token
  isn't exposed to the shell); the release script uses the Git Data API via
  the connector proxy instead.
- Azure's own build is not used — the Actions workflow deploys a finished
  package (`SCM_DO_BUILD_DURING_DEPLOYMENT` should stay off on the App
  Service).
- The release script's implementation is `scripts/src/release.ts`; transport,
  checkpoint, manifest and Actions polling logic have unit tests in `scripts/src/release-core.test.ts`
  and `scripts/src/release-poll.test.ts`
  (`cd scripts && pnpm exec vitest run`).
