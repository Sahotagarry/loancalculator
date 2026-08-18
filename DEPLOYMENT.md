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
3. **Push** — syncs the current source to GitHub `main` through the Replit
   GitHub connector (Git Data API). No tokens are stored in this project, and
   `.github/` (the IT admin's workflow files) is never touched.
4. **Wait for Azure** — polls the GitHub Actions run for the pushed commit
   every 10 seconds (5-minute deadline). The command only succeeds when the
   deployment concludes successfully, so "the command succeeded" means "the
   new version is live". On failure it prints the run URL and exits non-zero.

Progress is visible at <https://github.com/Sahotagarry/loancalculator/actions>.

## Versioning

The app version lives in the root `package.json` (single source of truth).
It is baked into both builds at build time: shown next to the logo in the app
header and served at `GET /api/version`.

## Notes

- Plain `git push` does not work with the Replit GitHub connection (its token
  isn't exposed to the shell); the release script uses the Git Data API via
  the connector proxy instead.
- Azure's own build is not used — the Actions workflow deploys a finished
  package (`SCM_DO_BUILD_DURING_DEPLOYMENT` should stay off on the App
  Service).
- Database schema changes are applied with the separate "Create database
  tables" workflow (`db-push.yml`) from the repository's Actions tab.
- The release script's implementation is `scripts/src/release.ts`; the
  Actions polling logic has unit tests in `scripts/src/release-poll.test.ts`
  (`cd scripts && pnpm exec vitest run`).
