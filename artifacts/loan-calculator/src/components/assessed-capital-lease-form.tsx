import type { Dispatch, SetStateAction } from "react";
import type { LoanFormState } from "./loan-form-fields";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { CounterpartyCombobox } from "./counterparty-combobox";
import { formatCurrency } from "@/lib/format";
import { leaseEndingSummary } from "./lease-opening-summary";

/** Creation after assessment: identify the agreement, do not re-enter its approved calculation. */
export function AssessedCapitalLeaseForm({ form, setForm, onReview }: {
  form: LoanFormState; setForm: Dispatch<SetStateAction<LoanFormState>>; onReview: () => void;
}) {
  return <div className="space-y-4" data-testid="assessed-capital-lease-form">
    <div className="space-y-1"><Label htmlFor="assessed-lease-name">Lease name</Label>
      <Input id="assessed-lease-name" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
    <div className="space-y-1"><Label htmlFor="assessed-lease-lessor">Lessor</Label>
      <CounterpartyCombobox id="assessed-lease-lessor" value={form.counterparty} onChange={counterparty => setForm(p => ({ ...p, counterparty }))} /></div>
    <div className="space-y-1"><Label htmlFor="assessed-lease-description">Description (optional)</Label>
      <Input id="assessed-lease-description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
    <section className="rounded-lg border p-3 space-y-3 text-sm" aria-label="Calculation carried forward from assessment">
      <p className="font-semibold">Calculation carried forward from assessment</p>
      <dl className="grid grid-cols-2 gap-3">
        <div><dt className="text-muted-foreground">Start date</dt><dd>{form.startDate}</dd></div>
        <div><dt className="text-muted-foreground">Lease term</dt><dd>{form.termMonths} months</dd></div>
        <div><dt className="text-muted-foreground">Monthly financing rental</dt><dd>{formatCurrency(form.paymentOverride ?? form.monthlyPayment ?? 0)}</dd></div>
        <div><dt className="text-muted-foreground">Discount rate</dt><dd>{Number(Number(form.interestRate).toFixed(5))}%</dd></div>
        <div><dt className="text-muted-foreground">Leased asset</dt><dd className="font-semibold">{formatCurrency(form.assetCost)}</dd></div>
        <div><dt className="text-muted-foreground">Opening lease obligation</dt><dd className="font-semibold">{formatCurrency(form.assetCost - form.downPayment)}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">{leaseEndingSummary(form.leaseEndingTerms)}</p>
      <Button type="button" variant="outline" onClick={onReview}>Change lease assessment</Button>
    </section>
  </div>;
}
