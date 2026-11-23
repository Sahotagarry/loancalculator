import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LeaseEndingTerms } from "@workspace/amortization";
import { LeaseEndingFields } from "../components/lease-ending-fields";
import { changeLeaseCommencement } from "./lease-import-calendar";

const warning = "Confirm inferred commencement against delivery or commencement evidence.";
const ending: LeaseEndingTerms = {
  version: 1, kind: "unresolved", amount: null, basis: "unsupported", source: "Document",
  settlementMonth: 48, issues: [warning, "Check the sale clause."], status: "draft",
  commencement: { date: "2026-04-01", basis: "inferred", source: "Agreement date, not confirmed delivery.", confirmed: false },
};
describe("review of suggested lease dates", () => {
  it("shows the suggestion as an editable date with explicit confirmation", () => {
    const html = renderToStaticMarkup(createElement(LeaseEndingFields, { value: ending, months: 48, onChange: () => {} }));
    expect(html).toContain("Suggested start date — confirm or change");
    expect(html).toContain('type="date"');
    expect(html).toContain('value="2026-04-01"');
    expect(html).toContain("first invoice or delivery record");
  });
  it("resolves only the date warning and keeps unrelated evidence unresolved", () => {
    const result = changeLeaseCommencement(ending, "2026-04-01", true);
    expect(result.commencement?.confirmed).toBe(true);
    expect(result.issues).toEqual(["Check the sale clause."]);
    expect(result.status).toBe("draft");
    expect(ending.commencement?.confirmed).toBe(false);
  });
  it("requires fresh confirmation after editing or clearing a date", () => {
    const confirmed = changeLeaseCommencement(ending, "2026-04-01", true);
    expect(changeLeaseCommencement(confirmed, "2026-04-02", false).commencement?.confirmed).toBe(false);
    expect(changeLeaseCommencement(confirmed, "", true).issues).toContain(warning);
    expect(changeLeaseCommencement(confirmed, "2026-02-30", true).commencement?.confirmed).toBe(false);
  });
});
