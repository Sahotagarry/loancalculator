import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => {
  let existingUser: unknown[] = [];
  let users: unknown[] = [];
  let firms: unknown[] = [];
  const inserts: unknown[] = [];
  let selectCount = 0;
  const table = new Proxy({}, { get: () => ({}) });
  const tx = {
    execute: async () => undefined,
    select: () => {
      const selection = selectCount++;
      return {
        from: () => selection === 0
          ? { where: async () => existingUser }
          : selection === 1
            ? { limit: async () => users }
            : { limit: async () => firms },
      };
    },
    insert: () => ({ values: (value: unknown) => ({ returning: async () => {
      inserts.push(value);
      return [inserts.length === 1 ? { id: "firm-id" } : { ...(value as object), firmId: "firm-id" }];
    } }) }),
  };
  return {
    db: { transaction: async (fn: (transaction: typeof tx) => unknown) => fn(tx) },
    table,
    reset(state: { existingUser?: unknown[]; users?: unknown[]; firms?: unknown[] } = {}) {
      existingUser = state.existingUser ?? []; users = state.users ?? []; firms = state.firms ?? [];
      inserts.length = 0; selectCount = 0;
    },
    inserts,
  };
});

vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}), sql: () => ({}) }));
vi.mock("@workspace/db", () => ({ db: mocked.db, appUsersTable: mocked.table, firmsTable: mocked.table }));

import { mayBootstrapFirstUser, signIn } from "./auth";

const tenantId = "11111111-1111-4111-8111-111111111111";
const bootstrapId = "22222222-2222-4222-8222-222222222222";
const arbitraryId = "33333333-3333-4333-8333-333333333333";
const identity = (objectId: string) => ({ tenantId, objectId, displayName: null, email: null });
const originalBootstrap = process.env.ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID;

afterEach(() => {
  mocked.reset();
  if (originalBootstrap === undefined) delete process.env.ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID;
  else process.env.ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID = originalBootstrap;
});

describe("first-user bootstrap", () => {
  it("does not let an arbitrary verified tenant principal create a firm or admin", async () => {
    process.env.ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID = bootstrapId;
    const principal = identity(arbitraryId);
    expect(mayBootstrapFirstUser(principal, false)).toBe(false);
    await expect(signIn(principal, mayBootstrapFirstUser(principal, false))).resolves.toBeNull();
    expect(mocked.inserts).toEqual([]);
  });

  it("permits only the configured production bootstrap identity to create the first admin", async () => {
    process.env.ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID = bootstrapId;
    const principal = identity(bootstrapId);
    const auth = await signIn(principal, mayBootstrapFirstUser(principal, false));
    expect(auth).toMatchObject({ objectId: bootstrapId, firmId: "firm-id", role: "admin" });
    expect(mocked.inserts).toHaveLength(2);
  });

  it("denies later unknown users without inserting records", async () => {
    process.env.ENTRA_BOOTSTRAP_ADMIN_OBJECT_ID = bootstrapId;
    mocked.reset({ users: [{ objectId: bootstrapId }] });
    const principal = identity(arbitraryId);
    await expect(signIn(principal, mayBootstrapFirstUser(principal, false))).resolves.toBeNull();
    expect(mocked.inserts).toEqual([]);
  });
});