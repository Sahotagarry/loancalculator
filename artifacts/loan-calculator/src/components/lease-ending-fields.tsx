import { useId } from "react";
import { acceptSuggestedLeaseTreatment, leaseEndingTreatmentLabel, normalizeLeaseEnding, type LeaseEndingTerms } from "@workspace/amortization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LeaseReviewDetails } from "./lease-review-details";
import { changeLeaseCommencement, validLeaseStartDate } from "@/lib/lease-import-calendar";
import { assessmentRate } from "@/lib/lease-assessment-values";

const kinds: Array<[LeaseEndingTerms["kind"], string]> = [
  ["unresolved", "Not yet established"], ["mandatory_payment", "Client must make a final payment / purchase"],
  ["guaranteed_residual", "Client covers a sale shortfall (guaranteed residual)"], ["optional_purchase", "Client may choose to purchase"],
  ["bargain_purchase", "Purchase option qualifies as a bargain"], ["lessor_residual", "Owner keeps the ending-value risk"],
  ["none", "No ending payment or guarantee"],
];

export function LeaseEndingFields({ value, months, onChange, readOnly }: {
  value?: LeaseEndingTerms | null; months: number; onChange: (value: LeaseEndingTerms) => void; readOnly?: boolean;
}) {
  const id = useId();
  if (!value) return <div className="rounded-lg border p-3 space-y-2">
    <p className="text-xs text-muted-foreground">This lease uses its previous ending treatment. Review the agreement before changing it; existing calculations are unchanged.</p>
    <Button type="button" variant="outline" disabled={readOnly} onClick={() => onChange({
      version: 1, kind: "unresolved", amount: null, basis: "stated", source: "", settlementMonth: months || null,
      status: "draft", issues: [],
    })}>Review ending terms</Button>
  </div>;
  const checked = normalizeLeaseEnding(value, months);
  const update = (patch: Partial<LeaseEndingTerms>) => onChange({ ...value, ...patch,
    ...(patch.kind && value.suggestedTreatment ? { suggestedTreatment: { ...value.suggestedTreatment, accepted: false } } : {}),
    ...(patch.paymentComponentsApplied === false ? { firstPaymentComponentsApplied: false } : {}), status: "draft" });
  const needsReview = value.status !== "reviewed" || checked.issues.length > 0;
  return <fieldset disabled={readOnly} className="space-y-3 min-w-0">
    <legend className="mb-2 text-sm font-semibold">Review details</legend>
    {value.suggestedTreatment && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 space-y-2">
      <p className="font-semibold">{value.suggestedTreatment.accepted && value.kind === value.suggestedTreatment.kind ? "Accepted assessment — based on available information" : "Best assessment — confirm or change"}</p>
      <p>{leaseEndingTreatmentLabel(value.suggestedTreatment.kind)}.</p>
      <p>{value.suggestedTreatment.reason}</p>
      {!value.suggestedTreatment.accepted && (value.kind === "unresolved" || value.kind === value.suggestedTreatment.kind) && <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={() => onChange(acceptSuggestedLeaseTreatment(value))}>Use this assessment</Button>}
      <p className="text-xs">Accepting records your assessment, not confirmation that the missing clause was found. Review the supporting explanation before approval.</p>
    </div>}
    {checked.issues.length > 0 && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-semibold">Resolve before approval</p>
      <ul className="list-disc pl-5">{checked.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
    </div>}
    <LeaseReviewDetails title="Ending terms and supporting clauses" needsAttention={needsReview}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label htmlFor={`${id}-kind`}>What must the client do at the end?</Label><select id={`${id}-kind`} name="leaseEndingKind" className="block w-full min-w-0 rounded border bg-background p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" value={value.kind} onChange={e => update({ kind: e.target.value as LeaseEndingTerms["kind"] })}>
          {kinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></div>
        <div className="space-y-1"><Label htmlFor={`${id}-amount`}>Ending payment or guaranteed amount ($)</Label><Input id={`${id}-amount`} name="leaseEndingAmount" type="number" min="0" step="0.01" value={value.amount ?? ""} onChange={e => update({ amount: e.target.value === "" ? null : Number(e.target.value), basis: "stated", explanation: "Reviewer-entered amount; see source explanation." })} /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-month`}>Months from lease start to settlement</Label><Input id={`${id}-month`} name="leaseSettlementMonth" type="number" min="0" value={value.settlementMonth ?? ""} onChange={e => update({ settlementMonth: e.target.value === "" ? null : Number(e.target.value), settlementMonthBasis: "separate" })} />
          <p className="text-xs text-muted-foreground">Lease term: {months || "not entered"} months. Use different settlement timing only when supported by the agreement.</p>
          {months > 0 && value.settlementMonth !== months && <Button type="button" variant="outline" size="sm" onClick={() => update({ settlementMonth: months, settlementMonthBasis: "lease_end" })}>Use lease end ({months} months)</Button>}
        </div>
        <div className="space-y-1">
          {value.implicitRate != null && <p className="text-sm" data-testid="lease-calculated-rate">Calculated lease rate (implicit): <strong>{Number(value.implicitRate.toFixed(5))}%</strong></p>}
          {(value.implicitRate != null || value.incrementalBorrowingRate != null || value.discountRate != null) && <p className="text-sm" data-testid="lease-selected-rate">Discount rate used: <strong>{Number(assessmentRate({ leaseEndingTerms: value, interestRate: value.discountRate ?? 0 }).toFixed(5))}%</strong></p>}
          <Label htmlFor={`${id}-rate`}>Client’s supported borrowing rate, if known (%)</Label><Input id={`${id}-rate`} name="leaseBorrowingRate" type="number" min="0" step="any" value={value.incrementalBorrowingRate ?? ""} onChange={e => update({ incrementalBorrowingRate: e.target.value === "" ? null : Number(e.target.value) })} /><p className="text-xs text-muted-foreground">This separate rate is what the client would pay for similar borrowing. Leave blank if unknown; it is not the calculated lease rate above.</p>
        </div>
      </div>
      <div className="space-y-1"><Label htmlFor={`${id}-source`}>Agreement clauses and your explanation</Label><Textarea id={`${id}-source`} name="leaseEndingSource" value={value.source} onChange={e => update({ source: e.target.value })} placeholder="Quote the purchase, return or sale-shortfall clause and explain the amount." /></div>
      {value.explanation && <p className="text-xs text-blue-800">Amount explanation: {value.explanation}</p>}
    </LeaseReviewDetails>
    <LeaseReviewDetails title="Taxes, services and refundable deposit" needsAttention={needsReview}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1"><Label htmlFor={`${id}-tax`}>Taxes in the payment</Label><select id={`${id}-tax`} name="leaseTaxTreatment" className="block w-full rounded border bg-background p-2 text-sm focus-visible:ring-2 focus-visible:ring-ring" value={value.taxTreatment ?? "excluded"} onChange={e => update({ taxTreatment: e.target.value as LeaseEndingTerms["taxTreatment"], paymentComponentsApplied: false })}>
          <option value="excluded">Payments exclude taxes</option><option value="recoverable">Recoverable tax included</option>
          <option value="nonrecoverable">Non-recoverable tax included</option><option value="unresolved">Not yet established</option>
        </select></div>
        <div className="space-y-1"><Label htmlFor={`${id}-services`}>Services included each month ($)</Label><Input id={`${id}-services`} name="leaseServicesMonthly" type="number" min="0" value={value.servicesMonthly ?? 0} onChange={e => update({ servicesMonthly: Number(e.target.value), paymentComponentsApplied: false })} /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-tax-rate`}>Supported tax rate (%)</Label><Input id={`${id}-tax-rate`} name="leaseTaxRate" type="number" min="0" step="any" value={value.taxRate ?? ""} onChange={e => update({ taxRate: Number(e.target.value), paymentComponentsApplied: false })} /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-deposit`}>Refundable deposit ($, not an upfront payment)</Label><Input id={`${id}-deposit`} name="leaseRefundableDeposit" type="number" min="0" step="0.01" value={value.refundableDeposit ?? ""} onChange={e => update({ refundableDeposit: Number(e.target.value) })} /></div>
      </div>
    </LeaseReviewDetails>
    {needsReview && <div className="space-y-1"><Label htmlFor={`${id}-issues`}>Evidence still missing or conflicting</Label><Textarea id={`${id}-issues`} name="leaseEndingIssues" value={value.issues.join("\n")} onChange={e => update({ issues: e.target.value.split("\n").filter(Boolean) })} placeholder="Missing appendix, conflicting terms, unsupported formula… Clear only after documenting the resolution in your explanation." /></div>}
    {value.commencement && <div className="rounded-lg border p-3 text-sm space-y-2">
      <Label htmlFor={`${id}-commencement`}>{value.commencement.basis === "inferred" ? "Suggested start date — confirm or change" : "Start date from the document"}</Label>
      <Input id={`${id}-commencement`} name="leaseSuggestedStartDate" type="date" value={value.commencement.date} onChange={e => onChange(changeLeaseCommencement(value, e.target.value, false))} />
      <p>{value.commencement.source}</p>
      <label className="flex items-start gap-2"><input name="leaseCommencementConfirmed" type="checkbox" className="mt-1" disabled={!validLeaseStartDate(value.commencement.date)} checked={value.commencement.confirmed} onChange={e => onChange(changeLeaseCommencement(value, value.commencement!.date, e.target.checked))} /> I checked the start date against the agreement, first invoice or delivery record.</label>
    </div>}
    <label className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input name="leaseEndingReviewed" type="checkbox" className="mt-1" disabled={checked.issues.length > 0} checked={value.status === "reviewed" && !checked.issues.length} onChange={e => onChange({ ...checked, status: e.target.checked ? "reviewed" : "draft" })} /><span>I reviewed what the client must pay, the amount and the supporting clauses. An optional purchase or value retained by the owner is not an amount the client must pay.</span></label>
    <p className="text-xs text-muted-foreground">{needsReview ? "Draft evidence — resolve missing information and check the review confirmation." : "Ending evidence reviewed. Changing any input requires review again."}</p>
  </fieldset>;
}
