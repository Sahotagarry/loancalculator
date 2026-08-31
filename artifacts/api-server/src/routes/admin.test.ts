import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  let existing = true;
  const created = { tenantId: "tenant", objectId: "33333333-3333-4333-8333-333333333333", firmId: "firm", role: "manager", isActive: true };
  const chain = {
    from() { return chain; }, where() { return chain; },
    limit: async () => existing ? [{ objectId: "22222222-2222-4222-8222-222222222222" }] : [],
  };
  const tx = {
    select: () => chain,
    insert: () => ({ values: () => ({ returning: async () => [created] }) }),
  };
  return {
    state: { setExisting: (value: boolean) => { existing = value; }, created },
    db: { transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) },
    table: new Proxy({}, { get: () => ({}) }),
  };
});
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}) }));
vi.mock("@workspace/db", () => ({
  db: mocked.db, appUsersTable: mocked.table, clientMembershipsTable: mocked.table, clientsTable: mocked.table,
}));
vi.mock("../lib/admin-guard", () => ({ removesLastActiveAdmin: () => false }));

import router from "./admin";

const post = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> }).stack
  .find((layer) => layer.route?.path === "/admin/users" && layer.route.methods.post)!.route!.stack[0].handle;

async function call(body: object) {
  let status: number | undefined; let payload: unknown;
  const res = {
    status(code: number) { status = code; return res; },
    json(value: unknown) { payload = value; },
  };
  await post({ body, auth: { tenantId: "tenant", firmId: "firm" } }, res);
  return { status, payload };
}

describe("POST /admin/users is create-only", () => {
  beforeEach(() => mocked.state.setExisting(true));
  it("does not demote or deactivate an existing sole admin", async () => {
    const response = await call({ objectId: "22222222-2222-4222-8222-222222222222", role: "manager", isActive: false });
    expect(response.status).toBe(409);
    expect(response.payload).toEqual({ error: "User already exists; edit users through PATCH" });
  });
  it("creates a new user", async () => {
    mocked.state.setExisting(false);
    const response = await call({ objectId: "33333333-3333-4333-8333-333333333333", role: "manager", isActive: true });
    expect(response.status).toBe(201);
    expect(response.payload).toEqual(mocked.state.created);
  });
});