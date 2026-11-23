import type { LoanEventInput } from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function newExtraPayment(sequence: number): LoanEventInput {
  return {
    kind: "principal_prepayment", effectiveDate: "", sequence, amount: 0,
    ordering: "after_scheduled_payment", treatment: "keep_payment", classification: "ordinary",
    source: "", reason: "", authoredAt: new Date().toISOString(),
  };
}

export function ExtraPrincipalPaymentFields({ payment, index, onChange, onRemove }: {
  payment: LoanEventInput; index: number;
  onChange: (patch: Partial<LoanEventInput>) => void; onRemove: () => void;
}) {
  const selectClass = "block w-full h-9 rounded border bg-background px-2";
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-semibold">Payment {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label>Actual payment date
          <Input type="date" required value={payment.effectiveDate.slice(0, 10)}
            onChange={e => onChange({ effectiveDate: e.target.value })} />
        </Label>
        <Label>Amount applied to principal ($)
          <Input type="number" min="0.01" step="0.01" required placeholder="0.00"
            value={payment.amount || ""} onChange={e => onChange({ amount: Number(e.target.value) })} />
        </Label>
      </div>
      <Label className="block">How does the lender handle future payments?
        <select className={selectClass} value={payment.treatment} onChange={e => onChange({ treatment: e.target.value as LoanEventInput["treatment"] })}>
          <option value="keep_payment">Keep the regular payment (may pay off sooner)</option>
          <option value="keep_maturity">Keep the end date and recalculate future payments</option>
        </select>
      </Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Label>Supporting document
          <Input placeholder="e.g. Lender statement, June 30" value={payment.source} required onChange={e => onChange({ source: e.target.value })} />
        </Label>
        <Label>Payment note
          <Input placeholder="e.g. Extra payment toward principal" value={payment.reason} required onChange={e => onChange({ reason: e.target.value })} />
        </Label>
      </div>
      <details open={payment.classification === "agreement_change" || undefined} className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Payment order and agreement changes</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Label>If a regular payment falls on the same day
            <select className={selectClass} value={payment.ordering} onChange={e => onChange({ ordering: e.target.value as LoanEventInput["ordering"] })}>
              <option value="before_scheduled_payment">Before the regular payment</option>
              <option value="after_scheduled_payment">After the regular payment</option>
            </select>
          </Label>
          <Label>Order among same-day payments
            <Input type="number" min="1" value={payment.sequence} onChange={e => onChange({ sequence: Math.max(1, Number(e.target.value)) })} />
          </Label>
          <Label>Was the agreement changed?
            <select className={selectClass} value={payment.classification} onChange={e => onChange({ classification: e.target.value as LoanEventInput["classification"] })}>
              <option value="ordinary">No — payment under existing terms</option>
              <option value="agreement_change">Yes — the agreement changed</option>
            </select>
          </Label>
        </div>
      </details>
      <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>Remove payment {index + 1}</Button>
    </fieldset>
  );
}
