import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import healthRouter from "./routes/health";
import { requireAuthentication } from "./middlewares/auth";
import { authorizeRequest } from "./middlewares/authorization";
import { logger } from "./lib/logger";
import { errorHandler } from "./middlewares/error-handler";
import { serveStaticIfAvailable } from "./static";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const normalizeOrigin = (value: string): string | null => {
  try { return new URL(value).origin; } catch { return null; }
};
const runtimeEnvironment = process.env["NODE_ENV"];
if (!runtimeEnvironment || !["development", "test", "production"].includes(runtimeEnvironment)) {
  throw new Error("NODE_ENV must be explicitly set to development, test, or production");
}
const production = runtimeEnvironment === "production";
const appOrigin = process.env["APP_ORIGIN"] ? normalizeOrigin(process.env["APP_ORIGIN"]) : null;
if (production && !appOrigin) throw new Error("APP_ORIGIN must be a valid complete origin in production");
const allowedOrigins = new Set(
  (process.env["CORS_ALLOWED_ORIGINS"] ?? "").split(",")
    .map((value) => normalizeOrigin(value.trim())).filter((value): value is string => value != null),
);
if (appOrigin) allowedOrigins.add(appOrigin);
if (!production) {
  const repl = process.env["REPLIT_DEV_DOMAIN"];
  if (repl) allowedOrigins.add(`https://${repl}`);
  allowedOrigins.add("http://localhost:3000"); allowedOrigins.add("http://localhost:5173");
}
const validOrigin = (req: express.Request): boolean => {
  const origin = req.header("origin");
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  return normalized != null && allowedOrigins.has(normalized);
};
app.use((req, res, next) => {
  if (!validOrigin(req)) {
    res.status(403).json({ error: "Cross-site request rejected" });
    return;
  }
  const origin = req.header("origin");
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", normalizeOrigin(origin)!);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Rate-Refresh-Secret");
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", healthRouter);
app.use("/api", requireAuthentication, authorizeRequest, router);

if (process.env["NODE_ENV"] === "production") {
  serveStaticIfAvailable(app);
}

app.use(errorHandler);

export default app;
