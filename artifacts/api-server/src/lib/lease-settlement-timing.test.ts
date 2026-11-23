import { describe, expect, it } from "vitest";
import { leaseEndingSchema } from "./lease-ending";
import { parseImportedLeaseEnding } from "./import-lease-ending";

const ending = { version: 1, kind: "guaranteed_residual", amount: 13322, basis: "stated",
  source: "Reviewed evidence", settlementMonth: 48, issues: [], status: "draft" };
describe("settlement timing intent", () => {
  it.each(["lease_end", "separate"])("round-trips %s intent without a database migration", basis => {
    expect(leaseEndingSchema.parse({ ...ending, settlementMonthBasis: basis }).settlementMonthBasis).toBe(basis);
  });
  it("does not inject timing metadata into historical evidence", () => {
    expect(leaseEndingSchema.parse(ending)).not.toHaveProperty("settlementMonthBasis");
  });
  it("does not treat a provider's timing declaration as a reviewer choice", () => {
    expect(parseImportedLeaseEnding({ ...ending, settlementMonthBasis: "separate" })).not.toHaveProperty("settlementMonthBasis");
  });
});
