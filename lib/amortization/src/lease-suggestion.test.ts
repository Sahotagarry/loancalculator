import { describe, expect, it } from "vitest";
import { acceptSuggestedLeaseTreatment, lesseeEndingAmount, normalizeLeaseEnding, type LeaseEndingTerms } from "./lease-ending";

const ending: LeaseEndingTerms = {
  version: 1, kind: "unresolved", amount: 13322, basis: "stated", source: "Agreed value and reserve table",
  settlementMonth: 48, status: "draft", issues: ["Ending obligation remains unresolved."],
  suggestedTreatment: { kind: "guaranteed_residual", reason: "Reserve pattern suggests a sale-shortfall obligation; settlement wording unconfirmed.", accepted: false },
};

describe("best-assessment adoption", () => {
  it("does not make a suggestion an accounting obligation", () => {
    const draft = normalizeLeaseEnding(ending, 48);
    expect(draft.kind).toBe("unresolved");
    expect(draft.amount).toBe(13322);
    expect(() => lesseeEndingAmount(draft)).toThrow();
  });
  it("requires an explicit reviewer adoption even if an unaccepted suggestion is copied into kind", () => {
    const attempted = normalizeLeaseEnding({ ...ending, kind: "guaranteed_residual", status: "reviewed", issues: [] }, 48);
    expect(attempted.status).toBe("draft");
    expect(attempted.issues).toContain("Confirm the suggested ending treatment or choose a different treatment.");
    expect(normalizeLeaseEnding(acceptSuggestedLeaseTreatment(attempted), 48).issues).toEqual([]);
  });
  it("records the accepted inference separately from the original document source", () => {
    const accepted = acceptSuggestedLeaseTreatment(ending);
    expect(accepted).toMatchObject({ kind: "guaranteed_residual", status: "draft", issues: [], suggestedTreatment: { accepted: true } });
    expect(accepted.source).toContain(ending.source);
    expect(accepted.source).toContain("Reviewer accepted an inferred treatment");
    expect(ending.kind).toBe("unresolved");
    expect(normalizeLeaseEnding(accepted, 48).issues).toEqual([]);
  });
  it("does not clear unrelated evidence warnings or finalize the review", () => {
    const accepted = acceptSuggestedLeaseTreatment({ ...ending, issues: [...ending.issues, "Confirm taxes."] });
    expect(accepted.issues).toEqual(["Confirm taxes."]);
    expect(accepted.status).toBe("draft");
  });
  it("does not add metadata to legacy evidence or replace an already chosen treatment", () => {
    const { suggestedTreatment: _, ...legacy } = ending;
    expect(normalizeLeaseEnding(legacy, 48)).not.toHaveProperty("suggestedTreatment");
    const chosen = { ...ending, kind: "optional_purchase" as const };
    expect(acceptSuggestedLeaseTreatment(chosen)).toBe(chosen);
  });
});
