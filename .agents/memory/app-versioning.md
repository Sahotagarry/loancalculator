---
name: App versioning
description: Where the app version lives and how it reaches the UI, API, and Azure deploys
---

# App versioning

- Single source of truth: `version` in the workspace ROOT package.json (artifact package.jsons stay 0.0.0).
- Frontend: Vite `define` bakes `__APP_VERSION__` at build (vite.config.ts reads root package.json); shown as "vX.Y.Z" next to the logo in PageHeader (data-testid text-app-version).
- API: esbuild `define` in api-server build.mjs bakes `__APP_VERSION__`; exposed at plain `GET /api/version` (health.ts, intentionally NOT in openapi/generated client).
- **Why baked, not runtime lookup:** the Azure deploy runs a standalone dist without the monorepo root package.json — runtime walk-up returns "unknown" there.
- **How to apply:** bump ONLY root package.json before exporting/syncing for an Azure deploy; both builds pick it up automatically. Never re-add a runtime package.json lookup.
