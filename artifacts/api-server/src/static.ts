import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { logger } from "./lib/logger";

export function serveStaticIfAvailable(app: Express): void {
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    logger.info(
      { distPath },
      "No built frontend found; skipping static file serving (API-only mode)",
    );
    return;
  }

  app.use(express.static(distPath));

  app.use("/{*path}", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(path.resolve(distPath, "index.html"));
  });

  logger.info({ distPath }, "Serving built frontend from API server");
}
