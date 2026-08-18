---
name: One-step release command
description: How `pnpm release` deploys to Azure via GitHub, and its guardrails
---

# One-step release (`pnpm release`)

- `scripts/src/release.ts` (tsx) syncs SOURCE to GitHub main (Sahotagarry/loancalculator); that repo's `.github/workflows/deploy.yml` builds and deploys to Azure App Service (clin-loan-app). Polling logic in `release-poll.ts` has unit tests.
- Auth is the Replit GitHub connector proxy (`@replit/connectors-sdk` → `createProxyFetch("github")`). **Shell `git push` does not work** — the connector token is never exposed to the shell; only the Git Data API via the proxy works.
- The connector proxy rate-limits ~10 req/s → blob uploads run in batches of 5 with 429/5xx retry (`ghRetry`).
- Guardrails: refuses on uncommitted changes; requires a root package.json version bump vs deployed (override `--allow-same-version`); never touches `.github/` (IT admin's); refuses deletions of files this workspace never tracked; rejects symlinks; success means the deploy workflow run (scoped by workflow path) concluded "success". Re-running after a timeout resumes by confirming the run for the current remote head.
- After success it reconciles local history with `merge -s ours origin/main` when non-protected content matches.
- **How to apply:** for any deploy request, bump root version, commit, run `pnpm release`. Keep local↔GitHub sync going through this script, not ad-hoc Git Data API pushes.
