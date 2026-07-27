---
name: API server error handling
description: How the api-server surfaces errors to clients, and why a global JSON error handler is required.
---

The api-server runs on Express 5, whose default error handler auto-forwards async route rejections but responds with an HTML stack trace (leaking SQL and file paths) in development.

**Rule:** All uncaught route errors must pass through the global error handler middleware (registered last in `app.ts`), which returns clean JSON `{ error }` and maps Postgres error codes (23505 unique → 409, 23503 FK → 409) to friendly messages. Never let the Express default handler respond.

**Why:** This is a financial (ASPE) tool used by accountants. A raw 500 HTML stack trace both confuses preparers and leaks internals. The generated client's `buildErrorMessage` reads the JSON `error` field, so a clean `{ error }` body is what surfaces in the client's `onError` toast.

**How to apply:**
- Client mutations should attach `onError` toasts using `getErrorMessage` (`artifacts/loan-calculator/src/lib/errors.ts`).
- Prefer letting DB constraint violations bubble to the global handler rather than pre-checking, unless a route needs a field-specific message.
