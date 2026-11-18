import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const user = { tenantId: "tenant", objectId: "user", role: "admin" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
let transport: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  transport = vi.fn(async () => json(user));
  vi.stubGlobal("window", { fetch: transport, addEventListener: vi.fn(), open: vi.fn() });
  vi.stubGlobal("document", { addEventListener: vi.fn(), dispatchEvent: vi.fn(), visibilityState: "visible" });
  vi.stubGlobal("location", { href: "https://example.test/", origin: "https://example.test" });
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("CustomEvent", class { constructor(public type: string, public init: unknown) {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("session recovery transport", () => {
  it("coalesces simultaneous verifications and verifies identity after renewal", async () => {
    const session = await import("./session-recovery");
    transport.mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json(user));
    const results = await Promise.all([session.verifySession(), session.verifySession(), session.verifySession()]);
    expect(results).toEqual([true, true, true]);
    expect(transport).toHaveBeenCalledTimes(3);
    expect(session.sessionSnapshot()).toBe("ready");
  });
  it("keeps a persistent read failure bounded and limits renewal frequency", async () => {
    const session = await import("./session-recovery");
    await session.verifySession();
    transport.mockImplementation(async (url: string) => url.endsWith("/clients") ? json({}, 401) : json(user));
    expect((await window.fetch("/api/clients")).status).toBe(401);
    expect((await window.fetch("/api/clients")).status).toBe(401);
    expect(transport.mock.calls.filter(([url]) => url === "/api/clients")).toHaveLength(4);
    expect(transport.mock.calls.filter(([url]) => url === "/.auth/refresh")).toHaveLength(1);
  });
  it("never repeats an interrupted save", async () => {
    const session = await import("./session-recovery");
    await session.verifySession();
    transport.mockImplementation(async (url: string) => url.endsWith("/clients") ? json({}, 401) : json(user));
    expect((await window.fetch("/api/clients", { method: "POST", body: "{}" })).status).toBe(401);
    expect(transport.mock.calls.filter(([url]) => url === "/api/clients")).toHaveLength(1);
  });
  it("distinguishes temporary verification failure and revoked access", async () => {
    const session = await import("./session-recovery");
    transport.mockResolvedValueOnce(json({}, 503));
    expect(await session.verifySession()).toBe(false);
    expect(session.sessionSnapshot()).toBe("unavailable");
    transport.mockResolvedValueOnce(json({}, 403));
    expect(await session.verifySession()).toBe(false);
    expect(session.sessionSnapshot()).toBe("denied");
    const count = transport.mock.calls.length;
    await window.fetch("/api/clients", { method: "POST" });
    expect(transport).toHaveBeenCalledTimes(count);
  });
  it("blocks a different identity and subsequent protected requests", async () => {
    const session = await import("./session-recovery");
    await session.verifySession();
    transport.mockResolvedValueOnce(json({ ...user, objectId: "different" }));
    expect(await session.verifySession()).toBe(false);
    expect(session.sessionSnapshot()).toBe("changed");
    const count = transport.mock.calls.length;
    await window.fetch("/api/clients");
    expect(transport).toHaveBeenCalledTimes(count);
  });
});
