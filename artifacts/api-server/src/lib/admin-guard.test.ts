import { describe, expect, it } from "vitest";
import { removesLastActiveAdmin } from "./admin-guard";

describe("last active admin guard", () => {
  const admin = { role: "admin" as const, isActive: true };
  it("blocks demotion or deactivation of the only active admin", () => {
    expect(removesLastActiveAdmin(admin, { role: "manager" }, 1)).toBe(true);
    expect(removesLastActiveAdmin(admin, { isActive: false }, 1)).toBe(true);
  });
  it("allows an admin change when another active admin remains", () => {
    expect(removesLastActiveAdmin(admin, { role: "manager" }, 2)).toBe(false);
    expect(removesLastActiveAdmin({ role: "manager", isActive: true }, { isActive: false }, 0)).toBe(false);
  });
});