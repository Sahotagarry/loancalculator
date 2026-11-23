import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { acceptSuggestedLeaseTreatment, type LeaseEndingTerms } from "@workspace/amortization";
import { LeaseEndingFields } from "../components/lease-ending-fields";

const value: LeaseEndingTerms = {
  version: 1, kind: "unresolved", amount: 13322, basis: "stated", source: "Reserve table",
  settlementMonth: 48, issues: ["Ending obligation remains unresolved."], status: "draft",
  suggestedTreatment: { kind: "guaranteed_residual", reason: "The reserve table suggests this arrangement; the settlement page was not supplied.", accepted: false },
};
const render = (v: LeaseEndingTerms, readOnly = false) => renderToStaticMarkup(createElement(LeaseEndingFields, {
  value: v, months: 48, readOnly, onChange: () => {},
}));

describe("plain-language lease best assessment", () => {
  it("shows a useful answer and the uncertainty rather than only unresolved", () => {
    const html = render(value);
    expect(html).toContain("Best assessment — confirm or change");
    expect(html).toContain("Client covers a loss when the asset is sold");
    expect(html).toContain("the settlement page was not supplied");
    expect(html).toContain("Use this assessment");
    expect(html).toContain("not confirmation that the missing clause was found");
  });
  it("retains the distinction between accepted inference and documentary fact", () => {
    const html = render(acceptSuggestedLeaseTreatment(value));
    expect(html).toContain("Accepted assessment — based on available information");
    expect(html).not.toContain("Use this assessment");
    expect(html).toContain("Reviewer accepted an inferred treatment");
  });
  it("respects read-only review", () => {
    expect(render(value, true)).toContain('<fieldset disabled=""');
  });
});
