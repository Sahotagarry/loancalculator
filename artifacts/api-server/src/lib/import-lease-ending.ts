import type { LeaseEndingTerms } from "@workspace/amortization";
import { leaseEndingSchema } from "./lease-ending";

const defaults = { version: 1, kind: "unresolved", amount: null, basis: "unsupported", source: "", settlementMonth: null, issues: [], status: "draft" };
const labels: Record<string, string> = {
  reserves: "monthly reserve rows", baseAmount: "original asset cost", percentage: "ending-value percentage",
  source: "supporting agreement wording", amount: "ending amount", settlementMonth: "settlement timing",
  taxTreatment: "tax treatment", sumAmounts: "amounts to add together", discountRate: "discount rate",
};

/** Tolerant provider boundary only. The saved/reviewed contract remains strict. */
export function parseImportedLeaseEnding(value: unknown): LeaseEndingTerms | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return {
    ...defaults, issues: ["The AI did not return structured ending details. Other extracted details were retained."],
  } as LeaseEndingTerms;
  const raw = value as Record<string, unknown>;
  const result: Record<string, unknown> = { ...defaults, issues: [] };
  const issues = Array.isArray(raw.issues) ? raw.issues.filter((v): v is string => typeof v === "string")
    : typeof raw.issues === "string" ? [raw.issues] : [];
  for (const [key, field] of Object.entries(leaseEndingSchema.shape)) {
    if (key === "status" || key === "issues" || key === "commencement" || key === "settlementMonthBasis") continue;
    const input = raw[key];
    // Optional nulls mean unavailable, not corruption of the whole evidence object.
    if (input == null) {
      if (key === "taxTreatment" && input === null) result.taxTreatment = "unresolved";
      continue;
    }
    const parsed = field.safeParse(input);
    if (parsed.success) {
      if (parsed.data !== undefined) result[key] = parsed.data;
    } else {
      issues.push(`The AI returned unusable ${labels[key] ?? key}. Review this detail; the other extracted ending details were retained.`);
    }
  }
  if (result.kind === "unresolved" && raw.kind != null && raw.kind !== "unresolved") {
    issues.push("The ending arrangement could not be interpreted reliably. Confirm the client's obligation.");
  }
  result.issues = [...new Set(issues)];
  return leaseEndingSchema.parse(result);
}
