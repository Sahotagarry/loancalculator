import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OperatingLeaseCardTerms } from "../components/operating-lease-card-terms";

const regular: ComponentProps<typeof OperatingLeaseCardTerms>["loan"] = {
  monthlyPayment: 900,
  firstPaymentAmount: null,
  termMonths: 12,
  freeRentMonths: 0,
  rentEscalationRate: 0,
  rentSteps: null,
};

describe("Year-End File operating lease card", () => {
  it.each([
    { name: "legacy equal rentals", changes: {}, total: "$10,800.00" },
    { name: "distinct first rental", changes: { firstPaymentAmount: 1900 }, total: "$11,800.00" },
    { name: "zero first rental", changes: { firstPaymentAmount: 0 }, total: "$9,900.00" },
    { name: "free months", changes: { freeRentMonths: 2 }, total: "$9,000.00" },
    { name: "annual escalation", changes: { termMonths: 24, rentEscalationRate: 10 }, total: "$22,680.00" },
    {
      name: "first rental after free months and rent steps",
      changes: { firstPaymentAmount: 1900, freeRentMonths: 2, rentEscalationRate: 50,
        rentSteps: [{ fromYear: 1, toYear: 1, monthlyRent: 950 }] },
      total: "$10,450.00",
    },
  ])("renders the contractual total for $name", ({ changes, total }) => {
    const html = renderToStaticMarkup(createElement(OperatingLeaseCardTerms, {
      loan: { ...regular, ...changes },
    }));
    expect(html).toContain(`Total Commitment</span><span class="font-medium">${total}</span>`);
    expect(html).toContain('Monthly Payment</span><span class="font-medium">$900.00</span>');
  });
});
