import { normalizeLeaseEnding, type LeaseEndingTerms } from "@workspace/amortization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const kinds: Array<[LeaseEndingTerms["kind"], string]> = [
  ["unresolved", "Unresolved ending terms"], ["mandatory_payment", "Required final payment / purchase"],
  ["guaranteed_residual", "Guaranteed residual / sale shortfall"], ["optional_purchase", "Optional purchase"],
  ["bargain_purchase", "Qualifying bargain purchase"], ["lessor_residual", "Unguaranteed lessor residual"],
  ["none", "No ending obligation"],
];

export function LeaseEndingFields({ value, months, onChange, readOnly }: {
  value?: LeaseEndingTerms | null; months: number; onChange: (value: LeaseEndingTerms) => void; readOnly?: boolean;
}) {
  if (!value) return <div className="rounded-lg border p-3 space-y-2">
    <p className="text-xs text-muted-foreground">Legacy ending treatment is unchanged. Review the agreement before adopting explicit ending terms.</p>
    <Button type="button" variant="outline" disabled={readOnly} onClick={() => onChange({
      version: 1, kind: "unresolved", amount: null, basis: "stated", source: "", settlementMonth: months || null,
      status: "draft", issues: [],
    })}>Review ending terms</Button>
  </div>;
  const checked = normalizeLeaseEnding(value, months);
  const update = (patch: Partial<LeaseEndingTerms>) => onChange({ ...value, ...patch,
    ...(patch.paymentComponentsApplied === false ? { firstPaymentComponentsApplied: false } : {}), status: "draft" });
  return <fieldset disabled={readOnly} className="rounded-lg border p-3 space-y-3">
    <legend className="px-1 text-sm font-semibold">Lease ending terms</legend>
    <div className="grid grid-cols-2 gap-3">
      <Label>Treatment<select className="block w-full rounded border p-2 text-xs" value={value.kind} onChange={e => update({ kind: e.target.value as LeaseEndingTerms["kind"] })}>
        {kinds.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></Label>
      <Label>Ending amount ($)<Input type="number" min="0" step="0.01" value={value.amount ?? ""} onChange={e => update({ amount: e.target.value === "" ? null : Number(e.target.value), basis: "stated", explanation: "Reviewer-entered amount; see source explanation." })} /></Label>
      <Label>Settlement month from commencement<Input type="number" min="0" value={value.settlementMonth ?? ""} onChange={e => update({ settlementMonth: e.target.value === "" ? null : Number(e.target.value) })} /></Label>
      <Label>Incremental borrowing rate (%)<Input type="number" min="0" step="any" value={value.incrementalBorrowingRate ?? ""} onChange={e => update({ incrementalBorrowingRate: e.target.value === "" ? null : Number(e.target.value) })} /></Label>
      <Label>Tax treatment<select className="block w-full rounded border p-2 text-xs" value={value.taxTreatment ?? "excluded"} onChange={e => update({ taxTreatment: e.target.value as LeaseEndingTerms["taxTreatment"], paymentComponentsApplied: false })}>
        <option value="excluded">Payments exclude taxes</option><option value="recoverable">Recoverable tax included</option>
        <option value="nonrecoverable">Non-recoverable tax included</option><option value="unresolved">Unresolved</option>
      </select></Label>
      <Label>Services included per month ($)<Input type="number" min="0" value={value.servicesMonthly ?? 0} onChange={e => update({ servicesMonthly: Number(e.target.value), paymentComponentsApplied: false })} /></Label>
      <Label>Supported tax rate (%)<Input type="number" min="0" step="any" value={value.taxRate ?? ""} onChange={e => update({ taxRate: Number(e.target.value), paymentComponentsApplied: false })} /></Label>
      <Label>Refundable deposit ($, not a down payment)<Input type="number" min="0" step="0.01" value={value.refundableDeposit ?? ""} onChange={e => update({ refundableDeposit: Number(e.target.value) })} /></Label>
    </div>
    <Label>Source clauses / review explanation<Textarea value={value.source} onChange={e => update({ source: e.target.value })} placeholder="Quote the amount basis and the operative purchase, return or shortfall clause." /></Label>
    {value.explanation && <p className="text-xs text-blue-800">Calculated, not stated: {value.explanation}</p>}
    <Label>Unresolved documentary issues<Textarea value={value.issues.join("\n")} onChange={e => update({ issues: e.target.value.split("\n").filter(Boolean) })} placeholder="Missing appendix, conflicting terms, unsupported formula… Clear only after documenting the resolution above." /></Label>
    {value.commencement && <div className="text-xs">
      <p>{value.commencement.basis === "inferred" ? "Inferred date — confirm before use" : "Document date"}: {value.commencement.date}. {value.commencement.source}</p>
      <label><input type="checkbox" checked={value.commencement.confirmed} onChange={e => update({ commencement: { ...value.commencement!, confirmed: e.target.checked } })} /> I verified commencement against the agreement/delivery evidence.</label>
    </div>}
    {checked.issues.length > 0 && <p className="text-xs text-amber-800">{checked.issues.join(" ")}</p>}
    <label className="flex gap-2 text-xs"><input type="checkbox" disabled={checked.issues.length > 0} checked={value.status === "reviewed" && !checked.issues.length} onChange={e => onChange({ ...checked, status: e.target.checked ? "reviewed" : "draft" })} /> I reviewed this treatment, amount and supporting clauses. Optional and lessor-retained values are not lessee obligations.</label>
  </fieldset>;
}
