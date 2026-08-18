import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Baked in at build time by esbuild `define` (see build.mjs); the value comes
// from the workspace root package.json — the single source of truth. Baking
// it in means the deployed bundle reports the right version even when it runs
// standalone (e.g. on Azure) without the monorepo around it.
declare const __APP_VERSION__: string | undefined;

const APP_VERSION =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Plain operational endpoint (not part of the generated API client):
// lets anyone check which version is running, e.g. https://<host>/api/version
router.get("/version", (_req, res) => {
  res.json({ version: APP_VERSION });
});

export default router;
