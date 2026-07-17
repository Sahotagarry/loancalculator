import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
const MAX_FAILURES = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

const tokens = new Map<string, number>(); // token -> expiry epoch ms

let failureCount = 0;
let lockedUntil = 0;

function prune(): void {
  const now = Date.now();
  for (const [token, expiry] of tokens) {
    if (expiry <= now) tokens.delete(token);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function adminPasswordConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export type UnlockResult =
  | { ok: true; token: string; expiresAt: string }
  | { ok: false; status: number; error: string };

export function unlock(password: string): UnlockResult {
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "No admin password has been configured. Set the ADMIN_PASSWORD secret first.",
    };
  }

  const now = Date.now();
  if (now < lockedUntil) {
    const waitMin = Math.ceil((lockedUntil - now) / 60000);
    return {
      ok: false,
      status: 429,
      error: `Too many incorrect attempts. Try again in about ${waitMin} minute${waitMin === 1 ? "" : "s"}.`,
    };
  }

  if (!timingSafeEqual(password, configured)) {
    failureCount += 1;
    if (failureCount >= MAX_FAILURES) {
      lockedUntil = now + LOCKOUT_MS;
      failureCount = 0;
    }
    return { ok: false, status: 401, error: "Incorrect password." };
  }

  failureCount = 0;
  prune();
  const token = crypto.randomBytes(32).toString("hex");
  const expiry = now + TOKEN_TTL_MS;
  tokens.set(token, expiry);
  return { ok: true, token, expiresAt: new Date(expiry).toISOString() };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const expiry = token ? tokens.get(token) : undefined;
  if (!expiry || expiry <= Date.now()) {
    if (token) tokens.delete(token);
    res.status(401).json({ error: "Admin password required. Unlock the Settings page first." });
    return;
  }
  next();
}
