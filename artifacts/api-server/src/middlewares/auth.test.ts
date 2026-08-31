import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { requireAuthentication, verifyEntraToken } from "./auth";
import { authorizeRequest, routeParts } from "./authorization";

describe("Entra token authentication", () => {
  it("fails closed for absent, malformed, or unsigned tokens", async () => {
    await expect(verifyEntraToken(undefined)).resolves.toBeNull();
    await expect(verifyEntraToken("not.a.token")).resolves.toBeNull();
    await expect(verifyEntraToken("eyJhbGciOiJub25lIn0.eyJ9.")).resolves.toBeNull();
  });
  it("accepts only a correctly signed token with discovered issuer, tenant and audience", async () => {
    const tenant = "11111111-1111-4111-8111-111111111111";
    const oid = "22222222-2222-4222-8222-222222222222";
    const client = "client-id";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test-key" })).toString("base64url");
    const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
    const payload = Buffer.from(JSON.stringify({ tid: tenant, oid, aud: client, iss: issuer, exp: Math.floor(Date.now() / 1000) + 60 })).toString("base64url");
    const token = `${header}.${payload}.${sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url")}`;
    const jwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => new Response(JSON.stringify(String(url).includes("openid-configuration")
      ? { issuer, jwks_uri: "https://keys.example/jwks" } : { keys: [{ ...jwk, kid: "test-key" }] }), { status: 200 })) as typeof fetch;
    const oldTenant = process.env.ENTRA_TENANT_ID; const oldClient = process.env.ENTRA_CLIENT_ID;
    process.env.ENTRA_TENANT_ID = tenant; process.env.ENTRA_CLIENT_ID = client;
    await expect(verifyEntraToken(token)).resolves.toMatchObject({ tenantId: tenant, objectId: oid });
    await expect(verifyEntraToken(`${token}x`)).resolves.toBeNull();
    process.env.ENTRA_TENANT_ID = oldTenant; process.env.ENTRA_CLIENT_ID = oldClient; globalThis.fetch = original;
  });
  it("never selects the development administrator outside an explicit Replit preview", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDevDomain = process.env.REPLIT_DEV_DOMAIN;
    const response = () => {
      const state = { statusCode: 0, body: undefined as unknown };
      return {
        state,
        status(code: number) { state.statusCode = code; return this; },
        json(body: unknown) { state.body = body; return this; },
      };
    };
    try {
      for (const value of [undefined, "staging", "Production"]) {
        if (value === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = value;
        delete process.env.REPLIT_DEV_DOMAIN;
        const res = response();
        let nextCalled = false;
        await requireAuthentication(
          { path: "/clients", header: () => undefined } as never,
          res as never,
          () => { nextCalled = true; },
        );
        expect(res.state.statusCode).toBe(401);
        expect(nextCalled).toBe(false);
      }
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalDevDomain === undefined) delete process.env.REPLIT_DEV_DOMAIN;
      else process.env.REPLIT_DEV_DOMAIN = originalDevDomain;
    }
  });
});

describe("authorization path and scheduler escape hatch", () => {
  it("extracts direct resource IDs before Express has populated params", () => {
    expect(routeParts("/clients/c/files")).toEqual(["clients", "c", "files"]);
    expect(routeParts("/files/f")).toEqual(["files", "f"]);
    expect(routeParts("/loans/l/source-document")).toEqual(["loans", "l", "source-document"]);
    expect(routeParts("/master-agreements/m")).toEqual(["master-agreements", "m"]);
    expect(routeParts("/trash/loan/t/restore")).toEqual(["trash", "loan", "t", "restore"]);
  });
  it("lets scheduler refresh reach its local secret middleware without auth context", async () => {
    const req = { path: "/rate-resets/refresh", method: "POST", header: () => undefined } as never;
    const res = { status: () => res, json: () => undefined } as never;
    let authNext = false; let authorizationNext = false;
    await requireAuthentication(req, res, () => { authNext = true; });
    await authorizeRequest(req, res, () => { authorizationNext = true; });
    expect(authNext).toBe(true);
    expect(authorizationNext).toBe(true);
  });
});