import { describe, it, expect, vi } from "vitest";

const state = vi.hoisted(() => {
  const rows = [{ id: "client-without-admin-membership", name: "Client" }];
  const where = vi.fn();
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn((filter) => { where(filter); return chain; }),
    orderBy: vi.fn(async () => rows),
  };
  return { rows, where, chain };
});
vi.mock("@workspace/db", () => ({
  db: { select: () => state.chain },
  clientsTable: { firmId: "firmId", deletedAt: "deletedAt", adoptedAt: "adoptedAt", quarantinedAt: "quarantinedAt", name: "name" },
  appUsersTable: {}, clientMembershipsTable: {},
}));
vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => ["eq", ...args],
  isNull: (column: string) => ["null", column],
  isNotNull: (column: string) => ["notNull", column],
  or: vi.fn(), sql: vi.fn(),
}));
import router from "./admin";

describe("admin client directory", () => {
  it("lists firm clients without requiring membership and excludes trash and quarantine", async () => {
    const layer = (router as any).stack.find((item: any) => item.route?.path === "/admin/clients");
    const json = vi.fn();
    await layer.route.stack[0].handle({ auth: { firmId: "firm-a" } }, { json });
    expect(json).toHaveBeenCalledWith(state.rows);
    expect(state.where).toHaveBeenCalledWith([
      ["eq", "firmId", "firm-a"], ["null", "deletedAt"],
      ["notNull", "adoptedAt"], ["null", "quarantinedAt"],
    ]);
  });
});
