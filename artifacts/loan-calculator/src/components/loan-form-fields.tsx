import { useState, type Dispatch, type SetStateAction } from "react";
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
  interestRate: number;
  amortizationYears: number;
  termYears: number;
  startDate: string;
  paymentFrequency: "monthly" | "semi-monthly" | "bi-weekly" | "weekly";
  ioMonths: number;
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
  if (form.interestRate < 0) return "Interest rate cannot be negative.";
  if (!form.amortizationYears || form.amortizationYears <= 0) return "Amortization is required.";
  if (!form.termYears || form.termYears <= 0) return "Term is required.";
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
              <Label htmlFor="rate">
                Interest Rate (%) <Req />
              </Label>
              <Input
                id="rate"
                type="number"
                step="0.01"
                value={form.interestRate || ""}
                onChange={(e) => setForm({ ...form, interestRate: e.target.value === "" ? 0 : Number(e.target.value) })}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
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
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            required
          />
        </div>
        {isDebt && (
          <div className="space-y-2">
            <Label htmlFor="freq">Payment Frequency</Label>
            <Select
              value={form.paymentFrequency}
              onValueChange={(v) => setForm({ ...form, paymentFrequency: v as any })}
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
