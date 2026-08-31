import { useState, type Dispatch, type SetStateAction } from "react";
import { addDays, addMonths, format, parseISO } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CounterpartyCombobox } from "@/components/counterparty-combobox";
import { SecurityCollateralFields } from "@/components/security-collateral-fields";

export interface LoanFormState {
  name: string;
  description: string;
  counterparty: string | null;
  isCapitalLease: boolean;
  principal: number;
  downPayment: number;
  interestRate: number | "";
  rateType: "fixed" | "prime_linked";
  rateBenchmark: string | null;
  contractualPrimeName: string | null;
  benchmarkEquivalentToContractualPrime: boolean;
  rateSpread: number | null;
  rateResetFrequency: "immediate" | "monthly" | "quarterly" | "annual" | null;
  rateEffectiveConvention: "observation_date" | "next_business_day" | "next_payment_date" | null;
  ratePaymentTreatment: "keep_payment" | "keep_maturity" | null;
  initialFvRateAssumption: { [key: string]: unknown } | null;
  amortizationYears: number;
  termYears: number;
  startDate: string;
  paymentFrequency: "monthly" | "semi-monthly" | "bi-weekly" | "weekly";
  paymentTiming: "beginning" | "end";
  graceTermMode: "included" | "added";
  /** Blank retains legacy date anchoring for existing records. */
  firstPaymentDate: string;
  /** UI-only: keeps derived dates in sync without overwriting contract dates. */
  firstPaymentDateDerived: boolean;
  semiMonthlyFirstDueDay: number | undefined;
  semiMonthlySecondDueDay: number | undefined;
  ioMonths: number;
  graceMonths: number;
  graceInterestTreatment: "capitalized" | "none";
  balloonPayment: number;
  transferOfOwnership: boolean;
  bargainPurchaseOption: boolean;
  leaseTermPct: number;
  pvPctFairValue: number;
  fairValue: number;
  specializedAsset: boolean;
  assetDescription: string;
  assetCost: number;
  assetUsefulLife: number;
  capitalLeaseRationale: string;
  monthlyPayment: number | undefined;
  paymentOverride: number | undefined;
  termMonths: number | undefined;
  isOfficeProperty: boolean;
  freeRentMonths: number;
  rentEscalationRate: number;
  rentSteps: Array<{ fromYear: number; toYear: number; monthlyRent: number }>;
  tenantImprovementAllowance: number;
  otherInducements: number;
  inducementReceivedInCash: boolean;
  covenantViolation: boolean;
  fvRate: number | undefined;
  fvDecision: "use_fv" | "trivial" | "immaterial" | undefined;
  fvDecisionNote: string;
  securityClauses: string[];
  collateralType: string;
  collateralDescription: string;
  collateralDepreciableCost: number;
  collateralLandCost: number;
  collateralInServiceDate: string;
  collateralMethod: string;
  collateralUsefulLifeYears: number;
  collateralDecliningRate: number;
  collateralSalvageValue: number;
}

export type LoanFormMode = "loan" | "capital_lease" | "operating_lease";

export function deriveFirstPaymentDate(
  startDate: string,
  paymentTiming: "beginning" | "end",
  graceMonths: number,
  frequency: LoanFormState["paymentFrequency"],
  firstDueDay?: number,
  secondDueDay?: number,
): string {
  const start = parseISO(startDate);
  if (isNaN(start.getTime())) return "";
  const graceBoundary = addMonths(start, Math.max(0, graceMonths));
  if (paymentTiming === "beginning") return format(graceBoundary, "yyyy-MM-dd");
  if (frequency === "monthly") return format(addMonths(graceBoundary, 1), "yyyy-MM-dd");
  if (frequency === "bi-weekly") return format(addDays(graceBoundary, 14), "yyyy-MM-dd");
  if (frequency === "weekly") return format(addDays(graceBoundary, 7), "yyyy-MM-dd");
  if (firstDueDay == null || secondDueDay == null) return format(addDays(graceBoundary, 15), "yyyy-MM-dd");
  const days = [firstDueDay, secondDueDay].sort((a, b) => a - b);
  for (let offset = 0; offset < 2; offset++) {
    const month = addMonths(new Date(graceBoundary.getFullYear(), graceBoundary.getMonth(), 1), offset);
    for (const day of days) {
      const candidate = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      candidate.setDate(Math.min(day, candidate.getDate()));
      if (candidate > graceBoundary) return format(candidate, "yyyy-MM-dd");
    }
  }
  return "";
}

export function getGraceTermPreview(
  statedTermMonths: number,
  graceMonths: number,
  mode: "included" | "added",
): { repaymentMonths: number; totalContractualMonths: number } {
  return {
    repaymentMonths: Math.max(0, statedTermMonths - (mode === "included" ? graceMonths : 0)),
    totalContractualMonths: statedTermMonths + (mode === "added" ? graceMonths : 0),
  };
}

export function shouldShowAssetTracking(mode: LoanFormMode, _securityClauses: string[]): boolean {
  // Only capital leases track a leased asset here. For loans, the pledged
  // asset is tracked in the Collateral Asset section (Security & Collateral).
  return mode === "capital_lease";
}

/** Returns an error message if required fields are missing, otherwise null. */
export function validateLoanForm(form: LoanFormState, mode: LoanFormMode): string | null {
  if (!form.name.trim()) return "Name is required.";
  if (!form.startDate) return "Inception date is required.";
  if (mode === "operating_lease") {
    if (!form.monthlyPayment || form.monthlyPayment <= 0) return "Monthly payment is required.";
    if (!form.termMonths || form.termMonths <= 0) return "Lease term is required.";
    return null;
  }
  if (!form.principal || form.principal <= 0) return "Principal is required.";
  if (form.downPayment < 0) return "Down payment cannot be negative.";
  if (form.downPayment >= form.principal) return "Down payment must be less than the principal.";
  if (form.interestRate === "") return "Interest rate is required.";
  if (form.interestRate < 0) return "Interest rate cannot be negative.";
  if (form.rateType === "prime_linked") {
    if (!(form.interestRate > 0)) return "Prime-linked loans require an evidenced positive opening contractual rate; no zero/public fallback is permitted.";
    if (!form.rateBenchmark) return "Prime-linked loans require the benchmark series.";
    if (!form.contractualPrimeName?.trim()) return "Confirm the lender's contractual prime name; a public BoC series is not necessarily lender prime.";
    if (form.rateSpread == null) return "Prime-linked loans require the contractual spread.";
    if (!form.rateResetFrequency || !form.rateEffectiveConvention || !form.ratePaymentTreatment) {
      return "Prime-linked loans require reset frequency, effective-date convention, and payment treatment.";
    }
    if (!form.initialFvRateAssumption || Object.keys(form.initialFvRateAssumption).length === 0) {
      return "Confirm and freeze the day-one fair-value rate assumption before creating a prime-linked loan.";
    }
  }
  if (!form.amortizationYears || form.amortizationYears <= 0) return "Amortization is required.";
  if (!form.termYears || form.termYears <= 0) return "Term is required.";
  if (form.firstPaymentDate && isNaN(parseISO(form.firstPaymentDate).getTime())) {
    return "First payment date is invalid.";
  }
  if (form.paymentFrequency === "semi-monthly") {
    const first = form.semiMonthlyFirstDueDay;
    const second = form.semiMonthlySecondDueDay;
    if (first == null || second == null || first < 1 || first > 31 || second < 1 || second > 31 || first === second) {
      return "Semi-monthly payments require two different due days from 1 through 31.";
    }
  }
  return null;
}

function Req() {
  return <span className="text-red-600">*</span>;
}

interface LoanFormFieldsProps {
  form: LoanFormState;
  setForm: Dispatch<SetStateAction<LoanFormState>>;
  mode?: LoanFormMode;
}

export function LoanFormFields({ form, setForm, mode = "loan" }: LoanFormFieldsProps) {
  const isOperating = mode === "operating_lease";
  const isDebt = !isOperating;
  const periodsPerYear =
    form.paymentFrequency === "semi-monthly"
      ? 24
      : form.paymentFrequency === "bi-weekly"
        ? 26
        : form.paymentFrequency === "weekly"
          ? 52
          : 12;
  // "Periods" only makes sense as a distinct unit when payments happen more
  // often than monthly (for monthly loans, periods === months).
  const offerPeriods = periodsPerYear > 12;
  const statedTermMonths = Math.round((form.termMonths ?? form.termYears * 12) * 100) / 100;
  const { repaymentMonths, totalContractualMonths } = getGraceTermPreview(
    statedTermMonths,
    form.graceMonths,
    form.graceTermMode,
  );
  const previewDate =
    form.firstPaymentDate && !isNaN(parseISO(form.firstPaymentDate).getTime())
      ? format(parseISO(form.firstPaymentDate), "MMMM d, yyyy")
      : form.startDate && !isNaN(parseISO(form.startDate).getTime())
        ? format(parseISO(form.startDate), "MMMM d, yyyy")
        : "Enter an inception date";
  const setDerivedFirstDate = (patch: Partial<LoanFormState>) => {
    const next = { ...form, ...patch };
    return {
      ...next,
      firstPaymentDate: next.firstPaymentDateDerived
        ? deriveFirstPaymentDate(next.startDate, next.paymentTiming, next.graceMonths, next.paymentFrequency, next.semiMonthlyFirstDueDay, next.semiMonthlySecondDueDay)
        : next.firstPaymentDate,
    };
  };

  type DurationUnit = "years" | "months" | "periods";

  const initialUnit = (years: number): DurationUnit => {
    if (!(years > 0) || Number.isInteger(years)) return "years";
    if (Number.isInteger(Math.round(years * 12 * 1e6) / 1e6)) return "months";
    return offerPeriods ? "periods" : "months";
  };

  const [termUnit, setTermUnit] = useState<DurationUnit>(() => initialUnit(form.termYears));

  const termDisplay =
    termUnit === "years"
      ? form.termYears || ""
      : termUnit === "months"
        ? form.termMonths ?? (form.termYears ? Math.round(form.termYears * 12) : "")
        : form.termYears
          ? Math.round(form.termYears * periodsPerYear)
          : "";

  const setTerm = (raw: string) => {
    const v = raw === "" ? 0 : Number(raw);
    if (termUnit === "years") {
      setForm({ ...form, termYears: v, termMonths: v > 0 ? Math.round(v * 12) : undefined });
    } else if (termUnit === "months") {
      setForm({ ...form, termMonths: v > 0 ? v : undefined, termYears: v > 0 ? v / 12 : 0 });
    } else {
      const years = v > 0 ? v / periodsPerYear : 0;
      setForm({ ...form, termYears: years, termMonths: years > 0 ? Math.round(years * 12) : undefined });
    }
  };

  const [amortUnit, setAmortUnit] = useState<DurationUnit>(() => initialUnit(form.amortizationYears));

  const amortDisplay =
    amortUnit === "years"
      ? form.amortizationYears || ""
      : form.amortizationYears
        ? Math.round(form.amortizationYears * (amortUnit === "months" ? 12 : periodsPerYear))
        : "";

  const setAmort = (raw: string) => {
    const v = raw === "" ? 0 : Number(raw);
    if (amortUnit === "years") {
      setForm({ ...form, amortizationYears: v });
    } else {
      const perYear = amortUnit === "months" ? 12 : periodsPerYear;
      setForm({ ...form, amortizationYears: v > 0 ? v / perYear : 0 });
    }
  };

  // If the frequency drops back to monthly while a unit is set to "periods",
  // fall back to months (same period length, clearer label).
  if (!offerPeriods) {
    if (termUnit === "periods") setTermUnit("months");
    if (amortUnit === "periods") setAmortUnit("months");
  }

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-2">
        <Label htmlFor="loanName">
          Name <Req />
        </Label>
        <Input
          id="loanName"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Building Mortgage"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="counterparty">{isOperating ? "Lessor" : "Counterparty"}</Label>
        <CounterpartyCombobox
          id="counterparty"
          value={form.counterparty}
          onChange={(v) => setForm({ ...form, counterparty: v })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Optional description"
        />
      </div>

      {isDebt && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="principal">
                Principal <Req />
              </Label>
              <Input
                id="principal"
                type="number"
                value={form.principal || ""}
                onChange={(e) => setForm({ ...form, principal: e.target.value === "" ? 0 : Number(e.target.value) })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rateType">Rate Type <Req /></Label>
              <Select
                value={form.rateType}
                onValueChange={(v) => setForm({ ...form, rateType: v as "fixed" | "prime_linked" })}
              >
                <SelectTrigger id="rateType"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="prime_linked">Prime-Linked Variable</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.rateType === "fixed" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rate">
                  Fixed Interest Rate (%) <Req />
                </Label>
                <Input
                  id="rate"
                  type="number"
                  step="0.01"
                  value={form.interestRate === "" ? "" : form.interestRate}
                  onChange={(e) => setForm({ ...form, interestRate: e.target.value === "" ? "" : Number(e.target.value) })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="downPayment">
                  {mode === "capital_lease" ? "Down Payment / First Payment" : "Down Payment"}
                </Label>
                <Input
                  id="downPayment"
                  type="number"
                  min="0"
                  value={form.downPayment || ""}
                  onChange={(e) => setForm({ ...form, downPayment: e.target.value === "" ? 0 : Number(e.target.value) })}
                  placeholder={
                    mode === "capital_lease"
                      ? "Paid at lease inception (optional)"
                      : "Lump sum paid upfront (optional)"
                  }
                />
                {form.downPayment > 0 && form.principal > form.downPayment ? (
                  <p className="text-xs text-muted-foreground">
                    {mode === "capital_lease" ? "Obligation financed" : "Amount financed"}:{" "}
                    {(form.principal - form.downPayment).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {form.rateType === "prime_linked" && (
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="openingRate">Opening Contractual Rate (%) <Req /></Label>
                  <Input
                    id="openingRate"
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.interestRate === "" ? "" : form.interestRate}
                    onChange={(e) => setForm({ ...form, interestRate: e.target.value === "" ? "" : Number(e.target.value) })}
                    placeholder="e.g. 7.20"
                    required
                  />
                  <p className="text-[10px] text-muted-foreground leading-tight">Must be evidenced from the contract.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="downPaymentPrime">
                    {mode === "capital_lease" ? "Down Payment / First Payment" : "Down Payment"}
                  </Label>
                  <Input
                    id="downPaymentPrime"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.downPayment || ""}
                    onChange={(e) => setForm({ ...form, downPayment: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rateBenchmark">Benchmark Rate <Req /></Label>
                  <Select
                    value={form.rateBenchmark || ""}
                    onValueChange={(v) => setForm({ ...form, rateBenchmark: v })}
                  >
                    <SelectTrigger id="rateBenchmark"><SelectValue placeholder="Select benchmark..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="boc_v80691311">Bank of Canada Prime (V80691311)</SelectItem>
                      <SelectItem value="OTHER">Other Prime</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rateSpread">Spread (%) <Req /></Label>
                  <Input
                    id="rateSpread"
                    type="number"
                    step="0.01"
                    value={form.rateSpread ?? ""}
                    onChange={(e) => setForm({ ...form, rateSpread: e.target.value === "" ? null : Number(e.target.value) })}
                    placeholder="e.g. +1.50 or -0.50"
                    required={form.rateType === "prime_linked"}
                  />
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={form.benchmarkEquivalentToContractualPrime}
                  onCheckedChange={(checked) => setForm({ ...form, benchmarkEquivalentToContractualPrime: checked === true })}
                />
                <span>I confirm the selected public benchmark is contractually equivalent to the lender prime. Leave unchecked when lender-prime evidence or an override is required.</span>
              </label>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="rateResetFrequency">Reset Frequency</Label>
                  <Select
                    value={form.rateResetFrequency || ""}
                    onValueChange={(v) => setForm({ ...form, rateResetFrequency: v as any })}
                  >
                    <SelectTrigger id="rateResetFrequency"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">Immediate</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rateEffectiveConvention">Effective Convention</Label>
                  <Select
                    value={form.rateEffectiveConvention || ""}
                    onValueChange={(v) => setForm({ ...form, rateEffectiveConvention: v as any })}
                  >
                    <SelectTrigger id="rateEffectiveConvention"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="observation_date">Observation Date</SelectItem>
                      <SelectItem value="next_business_day">Next Business Day</SelectItem>
                      <SelectItem value="next_payment_date">Next Payment Date</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contractualPrimeName">Contractual Prime Name</Label>
                  <Input
                    id="contractualPrimeName"
                    value={form.contractualPrimeName || ""}
                    onChange={(e) => setForm({ ...form, contractualPrimeName: e.target.value || null })}
                    placeholder="e.g. RBC Prime"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ratePaymentTreatment">Payment Recalculation</Label>
                  <Select
                    value={form.ratePaymentTreatment || ""}
                    onValueChange={(v) => setForm({ ...form, ratePaymentTreatment: v as any })}
                  >
                    <SelectTrigger id="ratePaymentTreatment"><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep_maturity">Adjust Payment (Keep Maturity)</SelectItem>
                      <SelectItem value="keep_payment">Adjust Maturity (Keep Payment)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="initialFvRateAssumption">Day-One FV Assumption Basis</Label>
                <Select
                  value={(form.initialFvRateAssumption as any)?.basis || ""}
                  onValueChange={(v) => setForm({ ...form, initialFvRateAssumption: v ? { basis: v } : null })}
                >
                  <SelectTrigger id="initialFvRateAssumption"><SelectValue placeholder="Select basis..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="constant_benchmark">Constant Initial Benchmark (Frozen)</SelectItem>
                    <SelectItem value="lender_schedule">Lender Provided Expected Schedule</SelectItem>
                    <SelectItem value="forward_curve">Forward Curve</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">The assumption used at initial recognition. Later realized prime observations never replace this day-one assumption retrospectively.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="downPaymentPrime">
                  {mode === "capital_lease" ? "Down Payment / First Payment" : "Down Payment"}
                </Label>
                <Input
                  id="downPaymentPrime"
                  type="number"
                  min="0"
                  value={form.downPayment || ""}
                  onChange={(e) => setForm({ ...form, downPayment: e.target.value === "" ? 0 : Number(e.target.value) })}
                  placeholder={
                    mode === "capital_lease"
                      ? "Paid at lease inception (optional)"
                      : "Lump sum paid upfront (optional)"
                  }
                />
                {form.downPayment > 0 && form.principal > form.downPayment ? (
                  <p className="text-xs text-muted-foreground">
                    {mode === "capital_lease" ? "Obligation financed" : "Amount financed"}:{" "}
                    {(form.principal - form.downPayment).toLocaleString("en-CA", { style: "currency", currency: "CAD" })}
                  </p>
                ) : null}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amort">
                Amortization <Req />
              </Label>
              <div className="flex gap-2">
                <Input
                  id="amort"
                  type="number"
                  className="flex-1"
                  value={amortDisplay}
                  onChange={(e) => setAmort(e.target.value)}
                  required
                />
                <Select
                  value={amortUnit}
                  onValueChange={(v) => setAmortUnit(v as DurationUnit)}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="years">Years</SelectItem>
                    <SelectItem value="months">Months</SelectItem>
                    {offerPeriods && <SelectItem value="periods">Payments</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {amortUnit !== "years" && form.amortizationYears ? (
                <p className="text-xs text-muted-foreground">
                  = {form.amortizationYears.toFixed(2).replace(/\.00$/, "")} years
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="term">
                Term <Req />
              </Label>
              <div className="flex gap-2">
                <Input
                  id="term"
                  type="number"
                  className="flex-1"
                  value={termDisplay}
                  onChange={(e) => setTerm(e.target.value)}
                  required
                />
                <Select
                  value={termUnit}
                  onValueChange={(v) => setTermUnit(v as DurationUnit)}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="years">Years</SelectItem>
                    <SelectItem value="months">Months</SelectItem>
                    {offerPeriods && <SelectItem value="periods">Payments</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {termUnit !== "years" && form.termYears ? (
                <p className="text-xs text-muted-foreground">
                  = {form.termYears.toFixed(2).replace(/\.00$/, "")} years
                </p>
              ) : null}
            </div>
          </div>
        </>
      )}

      {isOperating && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="monthly">
              Monthly Payment ($) <Req />
            </Label>
            <Input
              id="monthly"
              type="number"
              value={form.monthlyPayment ?? ""}
              onChange={(e) =>
                setForm({ ...form, monthlyPayment: e.target.value ? Number(e.target.value) : undefined })
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="termMo">
              Term (months) <Req />
            </Label>
            <Input
              id="termMo"
              type="number"
              value={form.termMonths ?? ""}
              onChange={(e) =>
                setForm({ ...form, termMonths: e.target.value ? Number(e.target.value) : undefined })
              }
              required
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="startDate">
            Inception Date <Req />
          </Label>
          <Input
            id="startDate"
            type="date"
            value={form.startDate}
            onChange={(e) => setForm(setDerivedFirstDate({ startDate: e.target.value }))}
            required
          />
        </div>
        {isDebt && (
          <div className="space-y-2">
            <Label htmlFor="freq">Payment Frequency</Label>
            <Select
              value={form.paymentFrequency}
              onValueChange={(v) => setForm(setDerivedFirstDate({ paymentFrequency: v as LoanFormState["paymentFrequency"] }))}
            >
              <SelectTrigger id="freq">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="semi-monthly">Semi-Monthly</SelectItem>
                <SelectItem value="bi-weekly">Bi-Weekly</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {isDebt && (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="paymentTiming">Payment Timing</Label>
              <Select value={form.paymentTiming} onValueChange={(v) => setForm(setDerivedFirstDate({ paymentTiming: v as "beginning" | "end" }))}>
                <SelectTrigger id="paymentTiming"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="end">End of each period</SelectItem>
                  <SelectItem value="beginning">Beginning of each period</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="firstPaymentDate">First Payment Date</Label>
              <Input id="firstPaymentDate" type="date" value={form.firstPaymentDate} onChange={(e) => setForm({ ...form, firstPaymentDate: e.target.value, firstPaymentDateDerived: false })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="graceTermMode">Grace Term Treatment</Label>
            <Select value={form.graceTermMode} onValueChange={(v) => setForm({ ...form, graceTermMode: v as "included" | "added" })}>
              <SelectTrigger id="graceTermMode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="included">Grace is included in the stated term</SelectItem>
                <SelectItem value="added">Grace extends the stated term</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.paymentFrequency === "semi-monthly" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="semiMonthlyFirstDueDay">First monthly due day</Label>
                <Input id="semiMonthlyFirstDueDay" type="number" min={1} max={31} value={form.semiMonthlyFirstDueDay ?? ""} onChange={(e) => setForm(setDerivedFirstDate({ semiMonthlyFirstDueDay: e.target.value === "" ? undefined : Number(e.target.value) }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="semiMonthlySecondDueDay">Second monthly due day</Label>
                <Input id="semiMonthlySecondDueDay" type="number" min={1} max={31} value={form.semiMonthlySecondDueDay ?? ""} onChange={(e) => setForm(setDerivedFirstDate({ semiMonthlySecondDueDay: e.target.value === "" ? undefined : Number(e.target.value) }))} />
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground" data-testid="text-payment-timing-preview">
            Actual first contractual payment: <strong>{previewDate}</strong>{form.firstPaymentDateDerived ? " (derived from inception, grace, and timing)" : form.firstPaymentDate ? "" : " (legacy inception-date anchor retained)"}. Repayment term: <strong>{repaymentMonths} months</strong>. Total contractual term: <strong>{totalContractualMonths} months</strong>.
            {form.graceMonths > 0 && ` For example, 60 repayment months + 13 months of added grace = 73 total months; when grace is included, 13 grace months within a 60-month term leave 47 repayment months.`}
          </p>
        </div>
      )}

      {isDebt && (
        <div className="space-y-2">
          <Label htmlFor="paymentOverride">Payment Override ($)</Label>
          <Input
            id="paymentOverride"
            type="number"
            step="0.01"
            value={form.paymentOverride ?? ""}
            placeholder="Leave blank to use the calculated payment"
            onChange={(e) =>
              setForm({ ...form, paymentOverride: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          <p className="text-xs text-muted-foreground">
            Optional — enter the contractual payment per period if it differs from the calculated amount.
          </p>
        </div>
      )}

      {isDebt && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="io">Interest Only Months</Label>
            <Input
              id="io"
              type="number"
              value={form.ioMonths}
              onChange={(e) => setForm({ ...form, ioMonths: Number(e.target.value) })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="balloon">Balloon Payment</Label>
            <Input
              id="balloon"
              type="number"
              value={form.balloonPayment}
              onChange={(e) => setForm({ ...form, balloonPayment: Number(e.target.value) })}
            />
          </div>
        </div>
      )}

      {isDebt && (
        <div className="space-y-2 border rounded-lg p-4 bg-muted/20">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="graceMonths">Payment Grace Period (months)</Label>
              <Input
                id="graceMonths"
                type="number"
                min={0}
                value={form.graceMonths}
                onChange={(e) => setForm(setDerivedFirstDate({ graceMonths: Math.max(0, Number(e.target.value)) }))}
              />
              <p className="text-xs text-muted-foreground">
                Months with no payments at all before repayment starts. {form.graceTermMode === "included" ? "They are included in the stated term." : "They extend the stated term."} The amortization period excludes them.
              </p>
            </div>
            {form.graceMonths > 0 && (
              <div className="space-y-2">
                <Label htmlFor="graceTreatment">Interest During Grace Period</Label>
                <select
                  id="graceTreatment"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={form.graceInterestTreatment}
                  onChange={(e) =>
                    setForm({ ...form, graceInterestTreatment: e.target.value as "capitalized" | "none" })
                  }
                >
                  <option value="capitalized">Accrues and is added to the balance</option>
                  <option value="none">No interest (interest-free)</option>
                </select>
                <p className="text-xs text-muted-foreground">
                  If interest is paid monthly during the deferral, use Interest Only Months instead.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {isDebt && (
        <SecurityCollateralFields
          value={form}
          onChange={(patch) => setForm({ ...form, ...patch })}
        />
      )}

      {shouldShowAssetTracking(mode, form.securityClauses) && (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
          <h3 className="font-display font-semibold text-sm">Leased Asset</h3>
          <div className="space-y-2">
            <Label htmlFor="assetDesc">Asset Description</Label>
            <Input
              id="assetDesc"
              value={form.assetDescription}
              onChange={(e) => setForm({ ...form, assetDescription: e.target.value })}
              placeholder="e.g. Building and Improvements"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="assetCost">Asset Cost</Label>
              <Input
                id="assetCost"
                type="number"
                value={form.assetCost}
                onChange={(e) => setForm({ ...form, assetCost: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assetLife">Useful Life (years)</Label>
              <Input
                id="assetLife"
                type="number"
                value={form.assetUsefulLife}
                onChange={(e) => setForm({ ...form, assetUsefulLife: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      )}

      {isDebt && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/50 p-3">
          <Checkbox
            id="covenantViolation"
            checked={form.covenantViolation}
            onCheckedChange={(checked) => setForm({ ...form, covenantViolation: checked === true })}
          />
          <div className="space-y-1">
            <Label htmlFor="covenantViolation">Financial covenant violation</Label>
            <p className="text-xs text-muted-foreground">
              Check if a financial covenant has been violated at year end. The counterparty has the right to demand repayment, so the entire obligation is classified as current, with scheduled repayments due beyond one year disclosed separately.
            </p>
          </div>
        </div>
      )}

      {isOperating && (
        <div className="space-y-4 border rounded-lg p-4 bg-amber-50/50 border-amber-200">
          <h3 className="font-display font-semibold text-sm">Straight-Line Lease Adjustments</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="freeRent">Free Rent (months)</Label>
              <Input id="freeRent" type="number" value={form.freeRentMonths} onChange={(e) => setForm({ ...form, freeRentMonths: Number(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="escalation">Rent Escalation (% / year)</Label>
              <Input id="escalation" type="number" step="0.01" disabled={form.rentSteps.length > 0} value={form.rentEscalationRate} onChange={(e) => setForm({ ...form, rentEscalationRate: Number(e.target.value) })} />
              {form.rentSteps.length > 0 && (
                <p className="text-xs text-muted-foreground">Ignored while a stepped rent schedule is entered below.</p>
              )}
            </div>
          </div>
          <div className="space-y-2 rounded-md border p-3 bg-background">
            <div className="flex items-center justify-between">
              <Label>Stepped Rent Schedule ($ per month)</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const last = form.rentSteps[form.rentSteps.length - 1];
                  const nextFrom = last ? last.toYear + 1 : 1;
                  setForm({ ...form, rentSteps: [...form.rentSteps, { fromYear: nextFrom, toYear: nextFrom, monthlyRent: 0 }] });
                }}
              >
                Add Step
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For leases where rent increases in dollar amounts (e.g. Years 1–2: $7,466.67/month, Years 3–4: $8,000/month). Enter each rent level and the lease years it covers.
            </p>
            {form.rentSteps.length > 0 && (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 text-xs text-muted-foreground font-medium">
                  <span>From year</span>
                  <span>To year</span>
                  <span>Monthly rent ($)</span>
                  <span />
                </div>
                {form.rentSteps.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-center">
                    <Input
                      type="number"
                      min={1}
                      value={s.fromYear || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          rentSteps: form.rentSteps.map((r, j) => (j === i ? { ...r, fromYear: Number(e.target.value) } : r)),
                        })
                      }
                    />
                    <Input
                      type="number"
                      min={1}
                      value={s.toYear || ""}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          rentSteps: form.rentSteps.map((r, j) => (j === i ? { ...r, toYear: Number(e.target.value) } : r)),
                        })
                      }
                    />
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={s.monthlyRent || ""}
                      placeholder="e.g. 7466.67"
                      onChange={(e) =>
                        setForm({
                          ...form,
                          rentSteps: form.rentSteps.map((r, j) => (j === i ? { ...r, monthlyRent: Number(e.target.value) } : r)),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setForm({ ...form, rentSteps: form.rentSteps.filter((_, j) => j !== i) })}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="tiAllowance">Tenant Improvement Allowance ($)</Label>
              <Input id="tiAllowance" type="number" value={form.tenantImprovementAllowance} onChange={(e) => setForm({ ...form, tenantImprovementAllowance: Number(e.target.value) })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="otherInducements">Other Inducements ($)</Label>
              <Input id="otherInducements" type="number" value={form.otherInducements} onChange={(e) => setForm({ ...form, otherInducements: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id="inducementReceivedInCash"
              checked={form.inducementReceivedInCash}
              onCheckedChange={(checked) => setForm({ ...form, inducementReceivedInCash: checked === true })}
            />
            <div className="space-y-1">
              <Label htmlFor="inducementReceivedInCash">Inducement received in cash</Label>
              <p className="text-xs text-muted-foreground">
                Check if received as cash (financing inflow in the cash flow statement). Leave unchecked for non-cash inducements such as free rent or landlord-provided tenant improvements, which are disclosed as a non-cash transaction.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
