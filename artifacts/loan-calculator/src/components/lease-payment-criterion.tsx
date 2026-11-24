import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { formatCurrency } from "@/lib/format";
import { assessmentRate, leaseRateGuidance, preTaxMonthlyPayment, type assessmentConclusion } from "@/lib/lease-assessment-values";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calculator } from "lucide-react";
import { LeasePaymentTest } from "./lease-payment-test";
import { LeaseRateFallback } from "./lease-rate-fallback";
import { LeaseEndingFields } from "./lease-ending-fields";
import type { AssessmentAnswers, ImportedEstimates } from "./capital-lease-assessment";
import { currentTaxTreatment, changeCriterionTaxTreatment, changeCriterionTaxRate, type LeaseTaxTreatment } from "@/lib/lease-payment-inputs";

type NumberKey = "fairValue" | "monthlyPayment" | "downPayment" | "interestRate";

const SOURCE_FIELDS: Array<[string, string]> = [
  ["monthlyPayment", "Monthly payment"], ["downPayment", "Down payment"], ["fairValue", "Fair value"],
  ["interestRate", "Interest rate"], ["paymentAtBeginning", "Payment timing"], ["termMonths", "Lease term"],
];

const fmtRate = (r: number) => Number(r.toFixed(5)).toString();

function Row({ label, children, htmlFor }: { label: string; htmlFor?: string; children: ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] items-center gap-x-3 gap-y-1">
    <Label htmlFor={htmlFor} className="text-sm text-muted-foreground font-normal">{label}</Label>
    <div className="min-w-0">{children}</div>
  </div>;
}

function Fold({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return <details className="rounded-lg border px-3 py-2 text-sm" data-testid={testId}>
    <summary className="cursor-pointer rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{title}</summary>
    <div className="mt-2 space-y-2">{children}</div>
  </details>;
}

/** Every input and evidence confirmation needed for the 90% test precedes its result. */
export function LeasePaymentCriterion({ answers, setAnswers, updateNumber, conclusion, readOnly, importedNotes, importedEstimates, onCalculateRate }: {
  answers: AssessmentAnswers;
  setAnswers: Dispatch<SetStateAction<AssessmentAnswers>>;
  updateNumber: (key: NumberKey, value: number) => void;
  conclusion: ReturnType<typeof assessmentConclusion>;
  readOnly?: boolean;
  importedNotes?: Record<string, string> | null;
  importedEstimates?: ImportedEstimates | null;
  onCalculateRate: () => void;
}) {
  const [rateText, setRateText] = useState<string | null>(null);
  const ending = answers.leaseEndingTerms;
  const tax = currentTaxTreatment(answers);
  const taxRate = ending?.taxRate ?? answers.taxRate;
  const rate = assessmentRate(answers);
  const guidance = leaseRateGuidance(answers, importedEstimates?.interestRate);
  const netPayment = preTaxMonthlyPayment(answers);
  const canCalc = answers.fairValue > 0 && answers.monthlyPayment > 0 && answers.termMonths > 0;
  const notes = importedNotes ? SOURCE_FIELDS.filter(([f]) => importedNotes[f]) : [];
  const fvEvidence = answers.fairValue > 0 || !!importedNotes?.fairValue;
  const extrasCount = [answers.firstPaymentAmount != null, answers.downPayment > 0, (ending?.refundableDeposit ?? 0) > 0].filter(Boolean).length;

  const setTax = (value: LeaseTaxTreatment) => setAnswers(prev => changeCriterionTaxTreatment(prev, value));
  const setTaxRate = (value: number | undefined) => setAnswers(prev => changeCriterionTaxRate(prev, value));
  const setServices = (value: number) => setAnswers(prev => prev.leaseEndingTerms ? ({
    ...prev, leaseEndingTerms: { ...prev.leaseEndingTerms, servicesMonthly: value,
      grossMonthlyPayment: prev.leaseEndingTerms.grossMonthlyPayment ?? prev.monthlyPayment,
      paymentComponentsApplied: false, firstPaymentComponentsApplied: false, status: "draft" as const },
  }) : prev);
  const setFirst = (value: number | null) => setAnswers(prev => ({ ...prev, firstPaymentAmount: value,
    ...(prev.leaseEndingTerms ? { leaseEndingTerms: { ...prev.leaseEndingTerms,
      grossFirstPaymentAmount: value ?? undefined, firstPaymentComponentsApplied: false, status: "draft" as const } } : {}),
  }));

  return <div className="space-y-3" data-testid="criterion4-compact">
    <fieldset disabled={readOnly} className="rounded-lg border p-3 space-y-2.5 min-w-0">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Inputs</legend>
      <Row label="Lease term"><p className="text-sm font-medium" data-testid="text-term-months">{answers.termMonths > 0 ? `${answers.termMonths} months` : "Not entered (criterion 3)"}</p></Row>
      <Row label="Monthly rental ($)" htmlFor="monthlyPayment">
        <Input id="monthlyPayment" data-testid="input-monthly-payment" type="number" step="0.01" min={0} className="h-9"
          value={answers.monthlyPayment || ""} onChange={e => updateNumber("monthlyPayment", Number(e.target.value))} />
      </Row>
      <Row label="Taxes in rental" htmlFor="c4TaxTreatment">
        <div className="flex flex-wrap items-center gap-2">
          <select id="c4TaxTreatment" data-testid="select-tax-treatment" className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm focus-visible:ring-2 focus-visible:ring-ring"
            value={tax} onChange={e => setTax(e.target.value as LeaseTaxTreatment)}>
            {tax === "" && <option value="" disabled>Choose</option>}
            <option value="excluded">Payments exclude taxes</option>
            <option value="recoverable">Recoverable tax included</option>
            {ending && <option value="nonrecoverable">Non-recoverable tax included</option>}
            {ending && <option value="unresolved">Not yet established</option>}
          </select>
          {tax === "recoverable" && <>
            <Input aria-label="Included recoverable tax rate (%)" data-testid="input-tax-rate" type="number" min={0} step="any" className="h-9 w-24"
              value={taxRate || ""} placeholder="Rate %" onChange={e => setTaxRate(e.target.value === "" ? undefined : Number(e.target.value))} />
          </>}
        </div>
        {tax === "recoverable" && !(taxRate > 0) && <p className="mt-1 text-xs text-amber-800" data-testid="text-tax-rate-needed">Enter the included tax rate.</p>}
        {tax === "unresolved" && <p className="mt-1 text-xs text-amber-800">Tax treatment not established; the result stays draft.</p>}
        {tax === "" && <p className="mt-1 text-xs text-amber-800">Choose how taxes are treated.</p>}
        {netPayment !== answers.monthlyPayment && answers.monthlyPayment > 0 && <p className="mt-1 text-xs text-muted-foreground" data-testid="text-net-payment">Used in test: {formatCurrency(netPayment)} per month</p>}
      </Row>
      <Row label="First payment">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="checkbox-payment-beginning" checked={answers.paymentAtBeginning}
            onChange={e => setAnswers(prev => ({ ...prev, paymentAtBeginning: e.target.checked,
              ...(prev.leaseEndingTerms ? { leaseEndingTerms: { ...prev.leaseEndingTerms, status: "draft" as const } } : {}) }))} />
          Due at lease start (in advance)
        </label>
      </Row>
      {ending && <Row label="Services in rental ($/mo)" htmlFor="c4Services">
        <Input id="c4Services" data-testid="input-services-monthly" type="number" min={0} step="0.01" className="h-9"
          value={ending.servicesMonthly ?? 0} onChange={e => setServices(Number(e.target.value))} />
        <p className="mt-1 text-xs text-muted-foreground">Enter 0 if the rental contains no service charges.</p>
      </Row>}
      <Row label="Fair value ($)" htmlFor="fairValue">
        <Input id="fairValue" data-testid="input-fair-value" type="number" step="1" min={0} className="h-9"
          value={answers.fairValue || ""} onChange={e => updateNumber("fairValue", Number(e.target.value))} placeholder="Cash price at lease start" />
        {!fvEvidence && importedEstimates?.fairValue != null && importedEstimates.fairValue > 0 && (
          <p className="mt-1 text-xs text-amber-900">AI estimate, not in document: {formatCurrency(importedEstimates.fairValue)}{" "}
            <Button type="button" size="sm" variant="outline" className="ml-1 h-6 px-2 text-xs" data-testid="button-use-fv-estimate"
              onClick={() => updateNumber("fairValue", importedEstimates.fairValue as number)}>Use and verify</Button>
          </p>
        )}
      </Row>
      <Row label="Discount rate (%)" htmlFor="interestRate">
        <div className="flex flex-wrap items-center gap-2">
          <Input id="interestRate" data-testid="input-discount-rate" type="number" step="any" min={0} className="h-9 w-32"
            value={rateText ?? (rate ? fmtRate(rate) : "")}
            onFocus={() => setRateText(rate ? fmtRate(rate) : "")}
            onBlur={() => setRateText(null)}
            onChange={e => { setRateText(e.target.value); updateNumber("interestRate", Number(e.target.value)); }} />
          <Button type="button" size="sm" variant="outline" className="h-9 gap-1 text-xs" data-testid="button-calculate-implicit-rate"
            disabled={!canCalc} onClick={onCalculateRate}>
            <Calculator className="h-3.5 w-3.5" /> Calculate implicit rate
          </Button>
        </div>
        {ending?.implicitRate != null && <p className="mt-1 text-xs text-muted-foreground">Implicit {fmtRate(ending.implicitRate)}%{ending.incrementalBorrowingRate != null ? `, borrowing ${fmtRate(ending.incrementalBorrowingRate)}%; lower is used` : ""}</p>}
        {rate > 0 && rate < 3 && <p className="mt-1 text-xs text-amber-800">Below-market rate: an ASPE 3856 fair value adjustment may be required later.</p>}
      </Row>
    </fieldset>

    <Fold title={`Additional payments${extrasCount ? ` (${extrasCount} entered)` : ""}`} testId="details-additional-payments">
      <fieldset disabled={readOnly} className="space-y-2.5 min-w-0">
        <Row label="Different first rental ($)" htmlFor="wizardFirstPayment">
          <Input id="wizardFirstPayment" data-testid="input-first-payment" type="number" min="0.01" step="0.01" className="h-9"
            value={answers.firstPaymentAmount ?? ""} placeholder="Blank if same as regular"
            onChange={e => setFirst(e.target.value === "" ? null : Number(e.target.value))} />
        </Row>
        <Row label="Down payment ($)" htmlFor="wizardDownPayment">
          <Input id="wizardDownPayment" data-testid="input-down-payment" type="number" step="0.01" min={0} className="h-9"
            value={answers.downPayment || ""} onChange={e => updateNumber("downPayment", Number(e.target.value))} placeholder="Not refundable deposits" />
        </Row>
        {ending && <Row label="Refundable deposit ($)" htmlFor="c4Deposit">
          <Input id="c4Deposit" type="number" min={0} step="0.01" className="h-9"
            value={ending.refundableDeposit ?? ""} onChange={e => setAnswers(prev => prev.leaseEndingTerms ? ({
              ...prev, leaseEndingTerms: { ...prev.leaseEndingTerms, refundableDeposit: e.target.value === "" ? undefined : Number(e.target.value), status: "draft" as const },
            }) : prev)} />
        </Row>}
        <p className="text-xs text-muted-foreground">A different first rental replaces the first payment; use the same tax and service basis as the monthly rental.</p>
      </fieldset>
    </Fold>

    <LeaseEndingFields compact hidePaymentComponents value={ending} months={answers.termMonths} readOnly={readOnly}
      onChange={leaseEndingTerms => setAnswers(prev => ({ ...prev, leaseEndingTerms }))} />

    <LeasePaymentTest conclusion={conclusion} compact />

    {(notes.length > 0 || guidance.showEstimate) && <Fold title="Source notes and rate help" testId="details-source-notes">
      {notes.map(([f, l]) => <p key={f} className="text-xs"><strong>{l}:</strong> {importedNotes![f]}</p>)}
      <LeaseRateFallback guidance={guidance} estimate={importedEstimates?.interestRate} />
    </Fold>}
    <Fold title="Guidance" testId="details-guidance">
      <p className="text-xs text-muted-foreground">Use the lower of the implicit rate, if determinable, and the client's supported borrowing rate. Fair value is the cash price at lease start, not the total of payments.</p>
      <p className="text-xs text-muted-foreground">Include a qualifying full guaranteed residual, required final payment or bargain purchase price. Exclude a non-bargain optional purchase, an unguaranteed residual, recoverable taxes and services.</p>
      <p className="text-xs text-muted-foreground">Do not choose a rate to obtain a preferred classification.</p>
    </Fold>
  </div>;
}
