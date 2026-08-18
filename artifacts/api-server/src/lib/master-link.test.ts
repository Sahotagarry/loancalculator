import { describe, it, expect } from "vitest";
import { resolveInheritedSecurityClauses } from "./master-link";

describe("copy-on-link security inheritance", () => {
  it("copies the master's wording when the facility has none", () => {
    expect(resolveInheritedSecurityClauses(undefined, null, "GSA over all assets")).toEqual([
      "GSA over all assets",
    ]);
    expect(resolveInheritedSecurityClauses([], undefined, "GSA over all assets")).toEqual([
      "GSA over all assets",
    ]);
  });

  it("keeps facility-provided clauses as overrides", () => {
    expect(resolveInheritedSecurityClauses(["First charge on equipment"], null, "GSA")).toBeNull();
  });

  it("keeps existing stored clauses when the request doesn't touch them", () => {
    expect(resolveInheritedSecurityClauses(undefined, ["Existing clause"], "GSA")).toBeNull();
  });

  it("copies nothing when the master has no security wording", () => {
    expect(resolveInheritedSecurityClauses(undefined, null, null)).toBeNull();
    expect(resolveInheritedSecurityClauses([], [], undefined)).toBeNull();
  });
});
