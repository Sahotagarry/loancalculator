import type { NextFunction, Request, RequestHandler, Response } from "express";
import { createPublicKey, verify } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { appUsersTable, db, firmsTable, type AppUserRole } from "@workspace/db";

export type AuthenticatedIdentity = {
  tenantId: string;
  objectId: string;
  displayName: string | null;
  email: string | null;
  firmId: string;
  role: AppUserRole;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedIdentity;
    }
  }
}

type Principal = Omit<AuthenticatedIdentity, "firmId" | "role">;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Jwk = { kid?: string; kty?: string; n?: string; e?: string; [key: string]: unknown };
let keyCache: { until: number; issuer: string; keys: Jwk[] } | null = null;
const TTL_MS = 5 * 60_000;
const decode = (value: string) => JSON.parse(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64url").toString("utf8")) as Record<string, unknown>;

async function keys(tenant: string, refresh = false): Promise<{ issuer: string; keys: Jwk[] } | null> {
  if (!refresh && keyCache && keyCache.until > Date.now()) return keyCache;
  const discovery = await fetch(`https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`);
  if (!discovery.ok) return null;
  const metadata = await discovery.json() as { issuer?: unknown; jwks_uri?: unknown };
  if (typeof metadata.issuer !== "string" || typeof metadata.jwks_uri !== "string") return null;
  const jwks = await fetch(metadata.jwks_uri);
  if (!jwks.ok) return null;
  const body = await jwks.json() as { keys?: unknown };
  if (!Array.isArray(body.keys)) return null;
  keyCache = { until: Date.now() + TTL_MS, issuer: metadata.issuer, keys: body.keys as Jwk[] };
  return keyCache;
}

/** Verify the Easy Auth AAD ID token. Principal headers are never an authority. */
export async function verifyEntraToken(token: string | undefined): Promise<Principal | null> {
  const tenant = process.env["ENTRA_TENANT_ID"];
  const client = process.env["ENTRA_CLIENT_ID"];
  if (!token || !tenant || !client || !GUID.test(tenant)) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decode(parts[0]); const claims = decode(parts[1]);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    for (const refresh of [false, true]) {
      const metadata = await keys(tenant, refresh);
      const jwk = metadata?.keys.find((key) => key.kid === header.kid && key.kty === "RSA");
      if (!metadata || !jwk) continue;
      const ok = verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk as never, format: "jwk" }), Buffer.from(parts[2], "base64url"));
      if (!ok) return null;
      const now = Math.floor(Date.now() / 1000);
      const aud = claims.aud;
      if (claims.tid !== tenant || claims.iss !== metadata.issuer || !(aud === client || Array.isArray(aud) && aud.includes(client)) ||
          typeof claims.exp !== "number" || claims.exp <= now || typeof claims.nbf === "number" && claims.nbf > now ||
          typeof claims.oid !== "string" || !GUID.test(claims.oid)) return null;
      return { tenantId: tenant, objectId: claims.oid, displayName: typeof claims.name === "string" ? claims.name : null,
        email: typeof claims.preferred_username === "string" ? claims.preferred_username : null };
    }
    return null;
  } catch { return null; }
}

function developmentPrincipal(): Principal {
  return {
    // Deliberately not configurable: previews must never accidentally become
    // a different tenant because of an inherited environment variable.
    tenantId: "clearline-development-tenant",
    objectId: "clearline-development-administrator",
    displayName: "Development Administrator",
    email: null,
  };
}

export function mayBootstrapFirstUser(identity: Principal, isReplitDevelopmentPreview: boolean): boolean {
  if (isReplitDevelopmentPreview) {
    return identity.tenantId === "clearline-development-tenant"
      && identity.objectId === "clearline-development-administrator";
  }
  const bootstrapObjectId = process.env["ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID"];
  return typeof bootstrapObjectId === "string"
    && GUID.test(bootstrapObjectId)
    && identity.objectId === bootstrapObjectId;
}

export async function signIn(identity: Principal, bootstrapAllowed: boolean): Promise<AuthenticatedIdentity | null> {
  return db.transaction(async (tx) => {
    // Serializes the single-firm bootstrap even if two first requests arrive together.
    await tx.execute(sql`select pg_advisory_xact_lock(7340937)`);
    const [user] = await tx
      .select()
      .from(appUsersTable)
      .where(and(eq(appUsersTable.tenantId, identity.tenantId), eq(appUsersTable.objectId, identity.objectId)));
    if (user) {
      await tx.update(appUsersTable)
        .set({ displayName: identity.displayName, email: identity.email })
        .where(and(eq(appUsersTable.tenantId, identity.tenantId), eq(appUsersTable.objectId, identity.objectId)));
      if (!user.isActive) return null;
      return { ...identity, firmId: user.firmId, role: user.role };
    }

    // Check bootstrap eligibility before a firm insert. This is global because
    // the deployment supports exactly one firm and must never create one for
    // an arbitrary first principal.
    const users = await tx.select({ objectId: appUsersTable.objectId }).from(appUsersTable).limit(1);
    if (users.length || !bootstrapAllowed) return null;

    const [existingFirm] = await tx.select().from(firmsTable).limit(1);
    if (existingFirm && existingFirm.tenantId !== identity.tenantId) return null;

    let firm = existingFirm;
    if (!firm) {
      [firm] = await tx.insert(firmsTable).values({
        tenantId: identity.tenantId,
        name: "Clearline",
      }).returning();
    }

    const [created] = await tx.insert(appUsersTable).values({
      tenantId: identity.tenantId, objectId: identity.objectId, firmId: firm.id,
      displayName: identity.displayName, email: identity.email, role: "admin", isActive: true,
    }).returning();
    return { ...identity, firmId: created.firmId, role: created.role };
  });
}

export const requireAuthentication: RequestHandler = async (req, res, next) => {
  // This endpoint is authenticated independently with its scheduler secret.
  if (req.path === "/rate-resets/refresh") return next();
  const environment = process.env["NODE_ENV"];
  const isReplitDevelopmentPreview = environment === "development"
    && typeof process.env["REPLIT_DEV_DOMAIN"] === "string"
    && process.env["REPLIT_DEV_DOMAIN"].length > 0;
  const identity = environment === "production"
    ? await verifyEntraToken(req.header("x-ms-token-aad-id-token"))
    : isReplitDevelopmentPreview
      ? developmentPrincipal()
      : null;
  if (!identity) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const auth = await signIn(identity, mayBootstrapFirstUser(identity, isReplitDevelopmentPreview));
  if (!auth) {
    res.status(403).json({ error: "Access has not been granted" });
    return;
  }
  req.auth = auth;
  next();
};

export function requireRole(...roles: AppUserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      res.status(403).json({ error: "Insufficient role" });
      return;
    }
    next();
  };
}