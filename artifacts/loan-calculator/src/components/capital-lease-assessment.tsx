import { assessmentConfirmationKey, assessmentConclusion, preTaxMonthlyPayment, financingFirstPayment, rentalAssessment, calculatePVFromAnswers, assessmentRate, percentLabel, normalizedAssessmentAnswers, changeAssessmentTerm, applyCalculatedLeaseRate, leasePricingAssumption, calculateAssessmentImplicitRate } from "@/lib/lease-assessment-values";
export { preTaxMonthlyPayment, calculatePVFromAnswers } from "@/lib/lease-assessment-values";
import { formatCurrency } from "@/lib/format";
import { useState, useCallback, useEffect, useRef } from "react";
import type { LeaseEndingTerms } from "@workspace/amortization";
import { LeaseEndingFields } from "./lease-ending-fields";
import { LeaseOpeningSummary } from "./lease-opening-summary";
import { LeasePaymentTest } from "./lease-payment-test";
import { LeaseReviewDetails } from "./lease-review-details";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ShieldCheck,
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Lightbulb,
  FileText,
  Calculator,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AssessmentAnswers = {
  leaseEndingTerms?: LeaseEndingTerms | null;
  firstPaymentAmount?: number | null;
  transferOfOwnership: boolean;
  bargainPurchaseOption: boolean;
  leaseTermPct: number;
  pvPctFairValue: number;
  fairValue: number;
  specializedAsset: boolean;
  assetType: string;
  economicLife: number;
  termMonths: number;
  monthlyPayment: number;
  downPayment: number;
  interestRate: number;
  paymentAtBeginning: boolean;
  paymentIncludesTax: boolean;
  taxType: "gst" | "hst" | "pst" | "none";
  taxRate: number;
  buyoutForImplicitRate: number;
};

export type RentStepInput = {
  fromYear: number;
  toYear: number;
  monthlyRent: number;
};

export type StraightLineAnswers = {
  freeRentMonths: number;
  rentEscalationRate: number;
  rentSteps: RentStepInput[];
  tenantImprovementAllowance: number;
  otherInducements: number;
  inducementReceivedInCash: boolean;
  /** Estimated monthly CAM / operating costs — executory costs kept out of rent expense math. */
  camMonthly: number;
};

export type AssessmentResult = {
  isCapitalLease: boolean;
  metCriteria: string[];
  rationale: string;
  answers: AssessmentAnswers;
  pvValue: number;
  straightLine?: StraightLineAnswers | null;
  isOfficeProperty: boolean;
};

export type ImportedEstimates = {
  economicLifeYears?: number | null;
  fairValue?: number | null;
  interestRate?: number | null;
  reasoning?: string | null;
};

interface Props {
  /** Existing leases save on confirmation; new leases continue to a form. */
  finalAction?: "save" | "continue";
  readOnly?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: AssessmentResult) => void;
  initialAnswers?: AssessmentAnswers;
  initialStraightLine?: StraightLineAnswers;
  /** Step to open at when initialAnswers is provided. Defaults to the conclusion
   * step (re-evaluation flow). Pass 0 to walk through every criterion (import flow). */
  initialStep?: number;
  /** Per-field source notes from the PDF import — field name → where/how the AI
   * found the value in the document. Shown as "From the document" provenance. */
  importedNotes?: Record<string, string> | null;
  /** AI estimates (clearly NOT from the document) for fields the document
   * doesn't state — economic life, fair value, interest rate. */
  importedEstimates?: ImportedEstimates | null;
}

/** Blue provenance chip: shows what the AI read in the document for a field. */
function DocSourceNote({ label, note }: { label: string; note: string }) {
  return (
    <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-50 border border-blue-200">
      <FileText className="h-3.5 w-3.5 text-blue-600 mt-0.5 flex-shrink-0" />
      <p className="text-xs text-blue-800">
        <span className="inline-flex items-center rounded bg-blue-100 border border-blue-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-900 mr-1.5">From the document</span>
        <strong>{label}:</strong> {note}
      </p>
    </div>
  );
}

/** Amber suggestion card: an AI estimate for a value the document doesn't state. */
function EstimateSuggestion({
  label,
  display,
  reasoning,
  applied,
  onApply,
}: {
  label: string;
  display: string;
  reasoning?: string | null;
  applied: boolean;
  onApply: () => void;
}) {
  return (
    <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-2">
      <div className="flex items-start gap-2">
        <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 space-y-1">
          <p className="text-xs text-amber-900">
            <span className="inline-flex items-center rounded bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 mr-1.5">AI estimate — not in document</span>
            <strong>{label}:</strong> {display}
          </p>
          {reasoning && <p className="text-xs text-amber-800">{reasoning}</p>}
          <p className="text-xs text-amber-700 italic">This was not stated in the lease — it's a suggestion to verify, not an extracted fact.</p>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs flex-shrink-0" onClick={onApply} disabled={applied}>
          {applied ? "Applied" : "Use estimate"}
        </Button>
      </div>
    </div>
  );
}

/** Which imported document fields are relevant to each wizard criterion. */
const FIELDS_BY_CRITERION: Record<string, Array<[string, string]>> = {
  transferOfOwnership: [["transferOfOwnership", "Transfer of ownership"]],
  bargainPurchaseOption: [
    ["bargainPurchaseOption", "Bargain purchase option"],
    ["buyoutAmount", "Buyout amount"],
  ],
  leaseTermPct: [
    ["termMonths", "Lease term (months)"],
    ["economicLifeYears", "Economic life"],
    ["assetType", "Asset type"],
  ],
  pvPctFairValue: [
    ["monthlyPayment", "Monthly payment"],
    ["downPayment", "Down payment"],
    ["fairValue", "Fair value"],
    ["interestRate", "Interest rate"],
    ["paymentAtBeginning", "Payment timing"],
    ["rentableSquareFeet", "Rentable square feet"],
  ],
  specializedAsset: [["specializedAsset", "Specialized asset"]],
};

type Criterion = {
  key: "transferOfOwnership" | "bargainPurchaseOption" | "leaseTermPct" | "pvPctFairValue" | "specializedAsset";
  title: string;
  question: string;
  concept: string;
  guide: string;
  documentHint: string;
  example: string;
  quickTip: string;
  isYesNo: boolean;
  thresholdLabel?: string;
  threshold?: number;
  unit?: string;
  min?: number;
  max?: number;
};

/** Typical economic life (years) by asset type — used to pre-fill Criterion 3. */
export const ASSET_TYPE_LIVES: Record<string, number> = {
  vehicle_light: 8,
  vehicle_heavy: 12,
  equipment_manufacturing: 15,
  equipment_office: 10,
  it_hardware: 5,
  it_software: 3,
  furniture: 15,
  building_leasehold: 20,
  building_industrial: 40,
  office_commercial: 40,
  land_lease: 99,
  aircraft: 25,
  rail_equipment: 30,
  medical: 12,
  other: 0,
};

const ASSET_TYPE_OPTIONS: Array<[string, string]> = [
  ["vehicle", "Vehicle (confirm useful life)"],
  ["vehicle_light", "Light Vehicle / Car (~8 years)"],
  ["vehicle_heavy", "Heavy Truck / Fleet (~12 years)"],
  ["equipment", "Equipment (confirm useful life)"],
  ["equipment_manufacturing", "Manufacturing Equipment (~15 years)"],
  ["equipment_office", "Office Equipment (~10 years)"],
  ["it_hardware", "IT / Computer Hardware (~5 years)"],
  ["it_software", "Software / SaaS License (~3 years)"],
  ["furniture", "Office Furniture / Fixtures (~15 years)"],
  ["building_leasehold", "Leasehold Improvements (~20 years)"],
  ["building_industrial", "Industrial Building (~40 years)"],
  ["office_commercial", "Office / Commercial Property (~40 years)"],
  ["land_lease", "Land Lease / Ground Lease (~99 years)"],
  ["aircraft", "Aircraft (~25 years)"],
  ["rail_equipment", "Rail / Rolling Stock (~30 years)"],
  ["medical", "Medical Equipment (~12 years)"],
  ["other", "Other / Custom (enter manually)"],
];

/** Real-property asset types eligible for the operating-lease fast track. */
const REAL_PROPERTY_TYPES = ["office_commercial", "building_industrial"];

/** Turn an internal asset-type code (e.g. "office_commercial") into a
 * user-friendly label (e.g. "Office / Commercial Property"), stripping the
 * "(~40 years)" hint used in the dropdown. Unknown values pass through. */
export function formatAssetType(value: string): string {
  if (!value) return "";
  const match = ASSET_TYPE_OPTIONS.find(([v]) => v === value);
  if (!match) return value;
  return match[1].replace(/\s*\(.*\)$/, "");
}

/** Reverse of formatAssetType: turn a stored asset description (either an
 * internal code like "office_commercial" or a friendly label like
 * "Office / Commercial Property") back into the internal code used by the
 * assessment dropdown. Returns "" when it doesn't match any known type. */
export function parseAssetType(stored: string): string {
  if (!stored) return "";
  const normalized = stored.trim().toLowerCase();
  const byCode = ASSET_TYPE_OPTIONS.find(([v]) => v === normalized);
  if (byCode) return byCode[0];
  const byLabel = ASSET_TYPE_OPTIONS.find(([, label]) => label.replace(/\s*\(.*\)$/, "").toLowerCase() === normalized);
  return byLabel ? byLabel[0] : "";
}

const CRITERIA: Criterion[] = [
  {
    key: "transferOfOwnership",
    title: "Transfer of Ownership",
    question: "Does the lease transfer ownership of the asset to the lessee by the end of the lease term?",
    concept: "From the lessee's perspective: if the lease contract says the asset will become the lessee's property when the lease ends, the lessee is essentially buying the asset over time through lease payments. ASPE says this must be recorded as a capital lease on the lessee's books because the lessee is the party taking on the risks and rewards of ownership.",
    guide: "Read the lease agreement from the lessee's point of view. Look for language that says the asset 'transfers,' 'conveys,' or 'title passes' to the lessee at lease expiration. If the contract is structured so that ownership automatically passes to the lessee, answer Yes.",
    documentHint: "Look in the 'End of Term' or 'Title Transfer' section of the lease agreement for language about ownership passing to the lessee.",
    example: "Example (lessee perspective): The lessee leases a vehicle, and the contract states 'title to the vehicle shall transfer to the lessee upon the final lease payment.' Because the lessee will end up owning the vehicle, this is a capital lease under this criterion.",
    quickTip: "From the lessee's view: if the lessee keeps the asset at the end, answer Yes. If the lessor takes it back, answer No.",
    isYesNo: true,
  },
  {
    key: "bargainPurchaseOption",
    title: "Bargain Purchase Option",
    question: "Does the lease contain a bargain purchase option?",
    concept: "From the lessee's perspective: a 'bargain purchase option' gives the lessee the right to buy the asset at lease-end for a price far below its fair market value. Because the lessee is almost certain to exercise it, this is economically the same as owning the asset. ASPE treats this as a capital lease on the lessee's books.",
    guide: "From the lessee's point of view: check if the lease gives the lessee an option to purchase the asset at lease-end. Compare the option price to the expected fair value of the asset at that date. If the option price is significantly lower (say, $1,000 to buy a $50,000 machine), it's a bargain.",
    documentHint: "Look for a 'Purchase Option' or 'Buyout' clause in the lease agreement. Ask the lessor or an appraiser for the asset's expected fair value at lease-end.",
    example: "Example (lessee perspective): The lessee has a 5-year lease on manufacturing equipment, and the contract includes a clause allowing the lessee to buy the equipment for $5,000 at lease-end. The equipment is expected to be worth $40,000 then. Because the lessee will almost certainly exercise this bargain option, this is a capital lease — answer Yes.",
    quickTip: "Compare the exercise price with expected fair value at exercise; no fixed percentage of original cost establishes a bargain.",
    isYesNo: true,
  },
  {
    key: "leaseTermPct",
    title: "Lease Term vs. Useful Life",
    question: "Is the lease term equal to or greater than 75% of the estimated economic life of the asset?",
    concept: "From the lessee's perspective: if the lessee is leasing the asset for most of its useful life, the lessee is effectively getting the bulk of the economic benefit from it — just like an owner would. That's why ASPE treats this as a capital lease on the lessee's books.",
    guide: "From the lessee's view: 1. Find the lease term in years from the lease agreement. 2. Estimate the asset's total useful life (how many years the asset is expected to remain productive — ask the lessor, check manufacturer specs, or use company policy). 3. Divide lease term by useful life and multiply by 100 to get a percentage. 4. If that percentage is 75% or higher, this criterion is met.",
    documentHint: "Lease term is in the agreement. Useful life may require an estimate — for common assets, 5-7 years for vehicles, 10 years for heavy equipment, 20-30 years for buildings.",
    example: "Example (lessee perspective): The lessee is leasing a delivery van for 5 years. Delivery vans typically have a useful life of 6 years. 5 / 6 = 83.3%. Since 83.3% is greater than 75%, this criterion is met for the lessee.",
    quickTip: "From the lessee's view: a 3-year lease on a 10-year asset = 30% (not met). A 7-year lease on a 9-year asset = 77.8% (met).",
    isYesNo: false,
    thresholdLabel: "Lease term as % of useful life",
    threshold: 75,
    unit: "%",
    min: 0,
    max: 100,
  },
  {
    key: "pvPctFairValue",
    title: "Minimum lease payments compared with fair value (90% test)",
    question: "Does the present value of minimum lease payments cover at least 90% of the asset’s fair value?",
    concept: "Minimum lease payments include rentals and qualifying ending amounts, including the full residual guarantee or bargain purchase price. Ownership and useful life are assessed separately.",
    guide: "Enter rentals, timing, fair value and the supported discount rate. Review the ending terms: include a qualifying guarantee, required final payment or bargain purchase price; exclude a non-bargain optional purchase and unguaranteed residual.",
    documentHint: "Check the rental schedule and the asset’s cash price at the start of the lease.",
    example: "If rentals have a present value of $85,000 and the guaranteed ending amount has a present value of $8,000, minimum lease payments cover 93% of a $100,000 fair value.",
    quickTip: "A guarantee is included because the client covers a shortfall, not because the client must buy the asset.",
    isYesNo: false,
    thresholdLabel: "PV of minimum lease payments as % of fair value",
    threshold: 90,
    unit: "%",
    min: 0,
    max: 100,
  },
  {
    key: "specializedAsset",
    title: "Specialized Asset (supporting evidence)",
    question: "Is the asset of a specialized nature such that only the lessee can use it without major modifications?",
    concept: "If the asset is custom-built or only the client can use it, that may support a transfer of the risks and rewards of ownership. It is supporting evidence, not an automatic capital lease test. Document the circumstances and review the other classification evidence.",
    guide: "From the lessee's view: ask yourself — could another party use this asset with minimal changes? If the asset was built specifically for the lessee's operations, contains the lessee's proprietary technology, or is located in a way that makes it impractical for others to use, answer Yes.",
    documentHint: "Review the asset specifications and any customization clauses in the lease. Ask operations staff if the asset is generic or custom-built for the lessee.",
    example: "Example (lessee perspective): A conveyor system built to the lessee's warehouse's exact dimensions and integrated with the lessee's specific packaging line. No other party could use it without major reconstruction. From the lessee's view, answer Yes. A standard forklift that any warehouse could use — from the lessee's view, answer No.",
    quickTip: "From the lessee's view: 'If the lessee ended the lease today, could the lessor easily lease this to someone else?' If no, it's specialized.",
    isYesNo: true,
  },
];

export default function CapitalLeaseAssessment({ open, onOpenChange, onConfirm, initialAnswers, initialStraightLine, initialStep, importedNotes, importedEstimates, readOnly, finalAction = "continue" }: Props) {
  const [step, setStep] = useState(0);
  const [confirmedAssessment, setConfirmedAssessment] = useState<string | null>(null);
  const [expandedCriterion, setExpandedCriterion] = useState<number | null>(null);
  const [showImplicitRateDialog, setShowImplicitRateDialog] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (open) {
      bodyRef.current?.scrollTo?.({ top: 0 });
      titleRef.current?.focus();
    }
  }, [step, open]);

  const defaultAnswers: AssessmentAnswers = {
    transferOfOwnership: false,
    bargainPurchaseOption: false,
    leaseTermPct: 0,
    pvPctFairValue: 0,
    fairValue: 0,
    specializedAsset: false,
    assetType: "",
    economicLife: 0,
    termMonths: 0,
    monthlyPayment: 0,
    downPayment: 0,
    interestRate: 0,
    paymentAtBeginning: false,
    paymentIncludesTax: false,
    taxType: "none",
    taxRate: 0,
    buyoutForImplicitRate: 0,
    leaseEndingTerms: { version: 1, kind: "unresolved", amount: null, basis: "stated", source: "", settlementMonth: null, issues: [], status: "draft" },
  };

  const defaultStraightLine: StraightLineAnswers = {
    freeRentMonths: 0,
    rentEscalationRate: 0,
    rentSteps: [],
    tenantImprovementAllowance: 0,
    otherInducements: 0,
    inducementReceivedInCash: false,
    camMonthly: 0,
  };

  const [inputs, setAnswers] = useState<AssessmentAnswers>(defaultAnswers);
  const rent = rentalAssessment(inputs);
  // Recompute the formal comparison from current evidence, never a stored percentage.
  const paymentTest = assessmentConclusion(inputs);
  const answers = { ...inputs, pvPctFairValue: paymentTest.minimum?.percent ?? 0 };
  const [straightLine, setStraightLine] = useState<StraightLineAnswers>(defaultStraightLine);

  const reset = useCallback(() => {
    setStep(0);
    setConfirmedAssessment(null);
    setExpandedCriterion(null);
    setAnswers(defaultAnswers);
    setStraightLine(defaultStraightLine);
  }, []);

  /** Set the asset type, pre-fill its typical economic life, and recompute
   * the lease-term % if a term is already entered. Shared by the intro step
   * and Criterion 3. */
  const applyAssetType = useCallback((val: string) => {
    const defaultLife = ASSET_TYPE_LIVES[val] || 0;
    setAnswers((prev) => ({
      ...prev,
      assetType: val,
      economicLife: defaultLife,
      leaseTermPct:
        prev.termMonths > 0 && defaultLife > 0
          ? Math.round((prev.termMonths / (defaultLife * 12)) * 1000) / 10
          : prev.leaseTermPct,
    }));
  }, []);

  // When opening with initialAnswers (e.g., reevaluating an existing lease),
  // pre-fill the form and jump straight to the conclusion step so the user
  // can review / modify answers. Use refs to avoid re-running when the parent
  // creates a new object reference on every render.
  const initialRef = useRef(initialAnswers);
  useEffect(() => {
    initialRef.current = initialAnswers;
  }, [initialAnswers]);

  const initialSLRef = useRef(initialStraightLine);
  useEffect(() => {
    initialSLRef.current = initialStraightLine;
  }, [initialStraightLine]);

  const initialStepRef = useRef(initialStep);
  useEffect(() => {
    initialStepRef.current = initialStep;
  }, [initialStep]);

  const prefilledRef = useRef(false);
  useEffect(() => {
    if (open && initialRef.current && !prefilledRef.current) {
      setAnswers(initialRef.current);
      if (initialSLRef.current) {
        setStraightLine(initialSLRef.current);
      }
      setStep(initialStepRef.current ?? 6);
      prefilledRef.current = true;
    }
    if (!open) {
      prefilledRef.current = false;
    }
  }, [open]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setTimeout(reset, 300);
  }, [onOpenChange, reset]);

  const computeResult = useCallback((): AssessmentResult => {
    const conclusion = assessmentConclusion(answers);
    const met = conclusion.reasons;
    const isCapitalLease = conclusion.status === "capital";
    const rationale = conclusion.rationale;
    const pvValue = step === 8 && isCapitalLease ? calculatePVFromAnswers(answers) : 0;
    const finalAnswers = normalizedAssessmentAnswers(answers);
    return { isCapitalLease, metCriteria: met, rationale, answers: finalAnswers, pvValue, straightLine: isCapitalLease ? null : straightLine, isOfficeProperty: answers.assetType === "office_commercial" };
  }, [answers, rent, step, straightLine]);

  const totalSteps = 8;

  const updateYesNo = (key: "transferOfOwnership" | "bargainPurchaseOption" | "specializedAsset", value: boolean) => {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  };



  const updateNumber = (key: "leaseTermPct" | "pvPctFairValue" | "fairValue" | "economicLife" | "termMonths" | "monthlyPayment" | "downPayment" | "interestRate" | "buyoutAmount" | "taxRate" | "buyoutForImplicitRate", value: number) => {
    setAnswers((prev) => {
      if (key === "termMonths") return changeAssessmentTerm(prev, value);
      const next = { ...prev, [key]: value,
        ...(prev.leaseEndingTerms ? { leaseEndingTerms: { ...prev.leaseEndingTerms, status: "draft" as const,
          ...(key === "monthlyPayment" ? { grossMonthlyPayment: value, paymentComponentsApplied: false } : {}),
          ...(key === "interestRate" ? { discountRate: value, implicitRate: null, incrementalBorrowingRate: null } : {}) } } : {}) };
      // Term edits are handled above; keep useful-life edits in sync too.
      if (key === "economicLife") {
        next.leaseTermPct = next.termMonths > 0 && next.economicLife > 0
          ? Math.round((next.termMonths / (next.economicLife * 12)) * 1000) / 10 : 0;
      }
      return next;
    });
  };

  const canProceed = () => {
    if (step === 6) return assessmentConclusion(answers).status !== "needs_review";
    if (step === 0) return true;
    if (step >= 1 && step <= 5) {
      const criterion = CRITERIA[step - 1];
      if (!criterion.isYesNo) {
        if (criterion.key === "pvPctFairValue") {
          return rent !== null;
        }
        if (criterion.key === "leaseTermPct") {
          return answers.termMonths > 0 && answers.economicLife > 0;
        }
      }
      return true;
    }
    return true;
  };

  const result = computeResult();
  const conclusion = assessmentConclusion(answers);
  // Bind confirmation to all evidence, not just the rounded percentage or outcome.
  const assessmentKey = assessmentConfirmationKey(answers);
  const changedSinceConclusion = (step === 8 || step === 7) && confirmedAssessment !== assessmentKey;
  const pricingEnd = leasePricingAssumption(answers);
  const hasPricingEnd = pricingEnd.fromEnding;

  const firstInstallmentField = <div className="space-y-2">
    <Label htmlFor="wizardFirstPayment">Distinct first rental ($, optional)</Label>
    <Input id="wizardFirstPayment" disabled={readOnly} type="number" min="0.01" step="0.01"
      value={answers.firstPaymentAmount ?? ""}
      onChange={e => {
        const value = e.target.value === "" ? null : Number(e.target.value);
        setAnswers(prev => ({ ...prev, firstPaymentAmount: value,
          ...(prev.leaseEndingTerms ? { leaseEndingTerms: { ...prev.leaseEndingTerms,
            grossFirstPaymentAmount: value ?? undefined, firstPaymentComponentsApplied: false, status: "draft" as const } } : {}),
        }));
      }} placeholder="Leave blank when the first rental equals the regular rental" />
    <p className="text-xs text-muted-foreground">Replaces the first rental, not an additional down payment. Use the same tax and service basis as the monthly payment.</p>
  </div>;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent scrollable className="max-w-2xl">
        <DialogHeader className="shrink-0 pr-6 text-left">
          <DialogTitle ref={titleRef} tabIndex={-1} className="font-display flex items-center gap-2 focus:outline-none">
            {step === 0 && <BookOpen className="h-5 w-5" />}
            {step >= 1 && step <= 5 && <HelpCircle className="h-5 w-5" />}
            {step === 6 && (result.isCapitalLease ? <ShieldCheck className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />)}
            {step === 0 && "Lease assessment"}
            {step >= 1 && step <= 5 && `Criterion ${step} of 5`}
            {step === 6 && "Is this a capital lease?"}
            {step === 7 && "Operating lease rent expense"}
            {step === 8 && "Capital lease calculation"}
          </DialogTitle>
          <DialogDescription>
            {step === 0 && "First classify the lease under ASPE 3065. Calculate the amounts to record in a separate step."}
            {step >= 1 && step <= 5 && CRITERIA[step - 1].title}
            {step === 6 && "Review the answer and its evidence. Confirm classification before calculating amounts to record."}
            {step === 8 && (changedSinceConclusion ? "Classification needs reconfirmation. Go back after reviewing your changes." : finalAction === "save" ? "Classification confirmed. Review opening amounts, then save changes to this lease." : "Classification confirmed. Review opening amounts, then continue to the lease form.")}
            {step === 7 && "Capture straight-line lease adjustments required for operating lease accounting."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody ref={bodyRef}>
        {/* Progress bar */}
        <div className="w-full bg-muted rounded-full h-2">
          <div
            className="bg-brand h-2 rounded-full transition-all"
            style={{ width: `${Math.min(step / (totalSteps - 1), 1) * 100}%` }}
          />
        </div>

        {/* Step 0: Introduction — overview with expandable criterion details */}
        {step === 0 && (
          <div className="space-y-5 py-2">
            <div className="p-4 rounded-lg bg-blue-50 border border-blue-200 space-y-3">
              <p className="text-sm text-blue-900">
                <strong>What you’ll decide:</strong> Is this a capital lease for the client using the asset? Review ownership, any bargain purchase option, useful life and required payments under ASPE 3065. Specialized use is supporting evidence, not a separate automatic test. You’ll see the conclusion before calculating any opening amounts.
              </p>
              <div className="text-xs text-blue-800 space-y-1 border-t border-blue-200 pt-2">
                <p><strong>Lessee</strong> = the party that <em>uses</em> the asset and makes lease payments.</p>
                <p><strong>Lessor</strong> = the party that <em>owns</em> the asset and collects lease payments.</p>
                <p className="italic">Note: The lessor has its own parallel classification (sales-type lease vs. direct financing lease), but this wizard focuses only on the lessee's classification.</p>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                The 5 Criteria You Will Evaluate
              </h3>
              <div className="space-y-2">
                {CRITERIA.map((c, i) => {
                  const isExpanded = expandedCriterion === i;
                  return (
                    <div key={c.key} className="rounded-lg border bg-muted/20 overflow-hidden">
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={`criterion-guide-${i}`}
                        className="flex w-full text-left items-start gap-3 p-3 cursor-pointer hover:bg-brand/5 hover:border-brand/30 transition-colors group focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => setExpandedCriterion(isExpanded ? null : i)}
                      >
                        <span className="flex-shrink-0 w-7 h-7 rounded-full bg-brand/10 text-brand text-xs font-bold flex items-center justify-center group-hover:bg-brand/20 group-hover:ring-2 group-hover:ring-brand/40 transition-all">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-sm group-hover:text-brand transition-colors">{c.title}</p>
                          <p className="text-xs text-muted-foreground">{c.isYesNo ? "Yes / No question" : `Numeric threshold: ${c.threshold}${c.unit} or greater`}</p>
                          <p className="text-xs text-brand/70 mt-0.5 font-medium">{isExpanded ? "Click to collapse" : "Click to learn more"}</p>
                        </div>
                        <ChevronRight className={`h-5 w-5 text-muted-foreground/40 mt-1 flex-shrink-0 transition-transform group-hover:text-brand/60 ${isExpanded ? "rotate-90" : ""}`} />
                      </button>
                      {isExpanded && (
                        <div id={`criterion-guide-${i}`} className="px-3 pb-3 space-y-3 border-t border-border/50 pt-3">
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            <strong className="text-foreground">What it means:</strong> {c.concept}
                          </p>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            <strong className="text-foreground">How to evaluate:</strong> {c.guide}
                          </p>
                          <div className="flex items-start gap-2 p-2 rounded-lg bg-blue-50 border border-blue-200">
                            <FileText className="h-3.5 w-3.5 text-blue-600 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-blue-800">
                              <strong>Where to look:</strong> {c.documentHint}
                            </p>
                          </div>
                          <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 border">
                            <Lightbulb className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-muted-foreground">{c.example}</p>
                          </div>
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 flex-shrink-0" />
                            <p className="text-xs text-muted-foreground italic">{c.quickTip}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
              <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-800">
                <strong>Tip:</strong> Have the lease agreement handy. Each step will tell you exactly which section of the contract to reference.
              </p>
            </div>

            {/* Asset type pre-fills useful life, but never replaces evidence. */}
            <div className="space-y-2 pt-1 border-t">
              <Label htmlFor="introAssetType">What kind of asset is being leased?</Label>
              <Select value={answers.assetType} onValueChange={applyAssetType}>
                <SelectTrigger id="introAssetType">
                  <SelectValue placeholder="Select an asset type (optional — you can also pick it later)" />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPE_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Picking the asset type now pre-fills its typical useful life for Criterion 3. Confirm that life against the asset's circumstances.
              </p>
            </div>

            {REAL_PROPERTY_TYPES.includes(answers.assetType) && (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-emerald-700 flex-shrink-0" />
                  <p className="text-sm font-semibold text-emerald-900">Property lease — evidence required</p>
                </div>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  Property type alone does not establish an operating lease. Complete the five criteria, including supported fair value, rental terms, discount rate and ending evidence, before confirming classification.
                </p>
                <p className="text-xs text-emerald-800 leading-relaxed">
                  Have the agreement and supporting estimates ready. Missing or conflicting evidence will remain marked Needs review.
                </p>
              </div>
            )}

            <Button
              onClick={() => setStep(1)}
              variant="default"
              className="w-full h-12 text-base"
            >
              Begin Criterion 1
            </Button>
          </div>
        )}

        {/* Steps 1-5: Criteria with rich educational content */}
        {step >= 1 && step <= 5 && (
          <div className="space-y-5 py-2">
            {(() => {
              const c = CRITERIA[step - 1];
              const answerVal = answers[c.key];
              const displayVal = c.key === "pvPctFairValue" ? percentLabel(answers.pvPctFairValue) : answerVal;
              return (
                <>
                  {/* Question card */}
                  <Card className="border-l-4 border-l-brand">
                    <CardContent className="p-4 space-y-3">
                      <p className="font-medium text-base">{c.question}</p>
                    </CardContent>
                  </Card>

                  {/* Provenance: what the AI read in the imported document for this criterion */}
                  {(() => {
                    if (!importedNotes) return null;
                    const rows = (FIELDS_BY_CRITERION[c.key] ?? []).filter(([field]) => importedNotes[field]);
                    if (rows.length === 0) return null;
                    return (
                      <div className="space-y-1.5">
                        {rows.map(([field, label]) => (
                          <DocSourceNote key={field} label={label} note={importedNotes[field]} />
                        ))}
                      </div>
                    );
                  })()}

                  <LeaseReviewDetails title="How to answer and where to look">
                  {/* Concept explanation */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                      <BookOpen className="h-4 w-4" />
                      What this criterion means
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed pl-6">
                      {c.concept}
                    </p>
                  </div>

                  {/* How to evaluate */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      How to evaluate this
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed pl-6">
                      {c.guide}
                    </p>
                  </div>

                  {/* Document hint */}
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <FileText className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-blue-800">
                      <strong>Where to look:</strong> {c.documentHint}
                    </p>
                  </div>

                  {/* Example */}
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border">
                    <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      {c.example}
                    </p>
                  </div>

                  {/* Quick tip */}
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground italic">
                      {c.quickTip}
                    </p>
                  </div>
                  </LeaseReviewDetails>

                  {/* Input area */}
                  <div className="pt-2 border-t">
                    <p className="text-sm font-semibold mb-3">Your answer:</p>
                    {c.isYesNo ? (
                      <div className="flex gap-3">
                        <Button
                          disabled={readOnly}
                          aria-pressed={Boolean(answerVal)}
                          variant={answerVal ? "default" : "outline"}
                          className="flex-1 gap-2 h-11"
                          onClick={() => updateYesNo(c.key as "transferOfOwnership" | "bargainPurchaseOption" | "specializedAsset", true)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Yes
                        </Button>
                        <Button
                          disabled={readOnly}
                          aria-pressed={!answerVal}
                          variant={!answerVal ? "default" : "outline"}
                          className="flex-1 gap-2 h-11"
                          onClick={() => updateYesNo(c.key as "transferOfOwnership" | "bargainPurchaseOption" | "specializedAsset", false)}
                        >
                          <XCircle className="h-4 w-4" />
                          No
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {c.key === "leaseTermPct" ? (
                          <div className="space-y-4">
                            {/* Asset Type */}
                            <div className="space-y-2">
                              <Label htmlFor="assetType">Type of Asset</Label>
                              <Select value={answers.assetType} onValueChange={applyAssetType}>
                                <SelectTrigger id="assetType">
                                  <SelectValue placeholder="Select an asset type" />
                                </SelectTrigger>
                                <SelectContent>
                                  {ASSET_TYPE_OPTIONS.map(([value, label]) => (
                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-muted-foreground">
                                Select the asset type to auto-fill a typical economic life. You can adjust it below if needed.
                              </p>
                            </div>

                            {/* Lease Term in Months */}
                            <div className="space-y-2">
                              <Label htmlFor="termMonths">Lease Term (months)</Label>
                              <Input disabled={readOnly}
                                id="termMonths"
                                type="number"
                                step="1"
                                min={1}
                                value={answers.termMonths || ""}
                                onChange={(e) => updateNumber("termMonths", Number(e.target.value))}
                                placeholder="e.g. 60 for a 5-year lease"
                              />
                            </div>

                            {/* Economic Life */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label htmlFor="economicLife">Economic Life (years)</Label>
                                {answers.assetType && (
                                  <span className="text-xs text-muted-foreground">
                                    Default for selected type
                                  </span>
                                )}
                              </div>
                              <Input disabled={readOnly}
                                id="economicLife"
                                type="number"
                                step="0.5"
                                min={0.5}
                                value={answers.economicLife || ""}
                                onChange={(e) => updateNumber("economicLife", Number(e.target.value))}
                                placeholder="e.g. 7 years"
                              />
                              <p className="text-xs text-muted-foreground">
                                You can override the default if your asset's useful life differs.
                              </p>
                              {importedEstimates?.economicLifeYears != null && importedEstimates.economicLifeYears > 0 && (
                                <EstimateSuggestion
                                  label="Economic life"
                                  display={`${importedEstimates.economicLifeYears} years`}
                                  reasoning={importedEstimates.reasoning}
                                  applied={answers.economicLife === importedEstimates.economicLifeYears}
                                  onApply={() => updateNumber("economicLife", importedEstimates.economicLifeYears as number)}
                                />
                              )}
                            </div>

                            {/* Calculated Result */}
                            {answers.leaseTermPct > 0 && (
                              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 text-sm">
                                <Calculator className="h-4 w-4 text-brand" />
                                <span>
                                  Calculated: <strong>{answers.termMonths}</strong> months / <strong>{answers.economicLife}</strong> years ={" "}
                                  <strong>{answers.leaseTermPct}%</strong> of useful life
                                </span>
                              </div>
                            )}
                          </div>
                        ) : c.key === "pvPctFairValue" ? (
                          <div className="space-y-5">
                            {/* Lease Term (carried forward) */}
                            {answers.termMonths > 0 && (
                              <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/20 text-sm">
                                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <span>Lease term from Criterion 3: <strong>{answers.termMonths} months</strong></span>
                              </div>
                            )}

                            {/* Monthly Payment */}
                            <div className="space-y-2">
                              <Label htmlFor="monthlyPayment">Monthly Lease Payment ($)</Label>
                              <Input disabled={readOnly}
                                id="monthlyPayment"
                                type="number"
                                step="0.01"
                                min={0}
                                value={answers.monthlyPayment || ""}
                                onChange={(e) => updateNumber("monthlyPayment", Number(e.target.value))}
                                placeholder="Enter the monthly amount from the lease agreement"
                              />
                            </div>

                            {/* Down payment / first payment at inception */}
                            {firstInstallmentField}
                            <div className="space-y-2">
                              <Label htmlFor="wizardDownPayment">Separate down payment at inception ($)</Label>
                              <Input disabled={readOnly}
                                id="wizardDownPayment"
                                type="number"
                                step="0.01"
                                min={0}
                                value={answers.downPayment || ""}
                                onChange={(e) => updateNumber("downPayment", Number(e.target.value))}
                                placeholder="Optional — lump sum paid when the lease starts"
                              />
                              <p className="text-xs text-muted-foreground">
                                Exclude refundable deposits. Do not enter the first regular rent here as well.
                              </p>
                            </div>

                            {/* Tax: pre-tax or includes tax */}
                            <div className="space-y-3">
                              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                                <Checkbox disabled={readOnly}
                                  id="paymentIncludesTax"
                                  checked={answers.paymentIncludesTax}
                                  onCheckedChange={(checked) => {
                                    setAnswers((prev) => {
                                      const next = {
                                        ...prev,
                                        paymentIncludesTax: checked === true,
                                        ...(prev.leaseEndingTerms ? { leaseEndingTerms: { ...prev.leaseEndingTerms, taxTreatment: checked === true ? "recoverable" as const : "excluded" as const, grossMonthlyPayment: prev.monthlyPayment, paymentComponentsApplied: false, firstPaymentComponentsApplied: false, status: "draft" as const } } : {}),
                                        taxType: checked === true ? prev.taxType : ("none" as AssessmentAnswers["taxType"]),
                                        taxRate: checked === true ? prev.taxRate : 0,
                                      };
                                      return next;
                                    });
                                  }}
                                />
                                <div>
                                  <Label htmlFor="paymentIncludesTax" className="cursor-pointer">Rental includes recoverable sales tax</Label>
                                  <p className="text-xs text-muted-foreground">Exclude only tax the client can recover; do not assume all taxes on the rental are recoverable.</p>
                                </div>
                              </div>

                              {answers.paymentIncludesTax && (
                                <div className="space-y-2 pl-2 border-l-2 border-brand/30">
                                  <Label>Province / Tax Rate</Label>
                                  <Select
                                    value={answers.taxType}
                                    onValueChange={(val) => {
                                      const rates: Record<string, number> = {
                                        none: 0,
                                        gst: 5,
                                        hst_on: 13,
                                        hst_ns_nb_nl: 15,
                                        hst_pe: 14,
                                        pst_bc: 7,
                                        pst_mb: 7,
                                        pst_sk: 6,
                                        qst: 9.975,
                                      };
                                      setAnswers((prev) => {
                                        const next = {
                                          ...prev,
                                          taxType: val as AssessmentAnswers["taxType"],
                                          taxRate: rates[val] || 0,
                                          ...(prev.leaseEndingTerms ? { leaseEndingTerms: { ...prev.leaseEndingTerms, taxRate: rates[val] || 0, status: "draft" as const } } : {}),
                                        };
                                        return next;
                                      });
                                    }}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select province / tax rate" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="gst">Alberta / GST only (5%)</SelectItem>
                                      <SelectItem value="hst_on">Ontario / HST (13%)</SelectItem>
                                      <SelectItem value="hst_ns_nb_nl">NS / NB / NL / PE / HST (15%)</SelectItem>
                                      <SelectItem value="hst_pe">Prince Edward Island / HST (14%)</SelectItem>
                                      <SelectItem value="pst_bc">British Columbia / GST+PST (12% total)</SelectItem>
                                      <SelectItem value="pst_mb">Manitoba / GST+PST (12% total)</SelectItem>
                                      <SelectItem value="pst_sk">Saskatchewan / GST+PST (11% total)</SelectItem>
                                      <SelectItem value="qst">Quebec / GST+QST (14.975% total)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {answers.taxRate > 0 && answers.monthlyPayment > 0 && (
                                    <div className="flex items-center gap-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-sm">
                                      <Calculator className="h-4 w-4 text-blue-600 flex-shrink-0" />
                                      <span className="text-blue-800">
                                        Pre-tax payment = <strong>${(answers.monthlyPayment / (1 + answers.taxRate / 100)).toFixed(2)}</strong>
                                        <span className="text-blue-600"> (tax stripped automatically)</span>
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Fair Value */}
                            <div className="space-y-3">
                              <Label htmlFor="fairValue">Fair Value of Leased Asset ($)</Label>
                              <Input disabled={readOnly}
                                id="fairValue"
                                type="number"
                                step="1"
                                min={0}
                                value={answers.fairValue || ""}
                                onChange={(e) => updateNumber("fairValue", Number(e.target.value))}
                                placeholder="Enter the fair market value at inception"
                              />
                              {importedEstimates?.fairValue != null && importedEstimates.fairValue > 0 && (
                                <EstimateSuggestion
                                  label="Fair value"
                                  display={`$${importedEstimates.fairValue.toLocaleString()}`}
                                  reasoning={importedEstimates.reasoning}
                                  applied={answers.fairValue === importedEstimates.fairValue}
                                  onApply={() => updateNumber("fairValue", importedEstimates.fairValue as number)}
                                />
                              )}
                              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
                                <p className="text-sm font-semibold text-blue-900">How to Determine Fair Value</p>
                                <p className="text-xs text-blue-800 leading-relaxed">
                                  Fair value is what the asset would cost the lessee to purchase it outright at lease inception. This is your benchmark — the PV of lease payments is compared against this number.
                                </p>
                                <div className="space-y-1.5 mt-1">
                                  <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-blue-800"><strong>Best source:</strong> Ask the lessor for the cash purchase price at inception. For vehicle and small truck leases, this is often shown directly on the lease invoice or agreement as the "capitalized cost" or "agreed value."</p>
                                  </div>
                                  <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-blue-800"><strong>Manufacturer MSRP:</strong> For vehicles and standard equipment, the manufacturer's suggested retail price is a reasonable proxy. Deduct any fleet or volume discounts the lessee would realistically receive.</p>
                                  </div>
                                  <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-blue-800"><strong>Used market:</strong> For older or specialized assets, check equivalent listings on marketplace sites or industry auction results.</p>
                                  </div>
                                  <div className="flex items-start gap-2">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-blue-800"><strong>Appraisal:</strong> For high-value assets (buildings, aircraft, custom manufacturing lines), a formal appraisal from a qualified valuator is the gold standard.</p>
                                  </div>
                                  <div className="flex items-start gap-2">
                                    <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 flex-shrink-0" />
                                    <p className="text-xs text-blue-800"><strong>Do NOT use:</strong> The total of all lease payments (undiscounted). That is not fair value — it ignores the time value of money and may include the buyout.</p>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Payment Timing */}
                            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/20">
                              <Checkbox disabled={readOnly}
                                id="paymentAtBeginning"
                                checked={answers.paymentAtBeginning}
                                onCheckedChange={(checked) => {
                                  setAnswers((prev) => {
                                    const next = { ...prev, paymentAtBeginning: checked === true };
                                    return next;
                                  });
                                }}
                              />
                              <div>
                                <Label htmlFor="paymentAtBeginning" className="cursor-pointer">First payment due at lease inception</Label>
                                <p className="text-xs text-muted-foreground">Typical for vehicle and equipment leases in Canada. Uncheck if the first payment is 30 days after signing.</p>
                              </div>
                            </div>

                            {/* Discount Rate */}
                            <div className="space-y-3">
                              <Label htmlFor="interestRate">Discount Rate (annual %)</Label>
                              <Input disabled={readOnly}
                                id="interestRate"
                                type="number"
                                step="0.01"
                                min={0.01}
                                value={assessmentRate(answers) || ""}
                                onChange={(e) => updateNumber("interestRate", Number(e.target.value))}
                                placeholder="e.g. 6.5"
                              />
                              {importedEstimates?.interestRate != null && importedEstimates.interestRate > 0 && (
                                <EstimateSuggestion
                                  label="Discount rate"
                                  display={`${importedEstimates.interestRate}% annual`}
                                  reasoning={importedEstimates.reasoning}
                                  applied={answers.interestRate === importedEstimates.interestRate}
                                  onApply={() => updateNumber("interestRate", importedEstimates.interestRate as number)}
                                />
                              )}
                              {/* ASPE 3856 low-rate warning inside wizard */}
                              {answers.interestRate > 0 && answers.interestRate < 3 && (
                                <div className={`rounded-lg border p-3 flex items-start gap-2 ${answers.interestRate < 1 ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
                                  <AlertTriangle className={`h-4 w-4 shrink-0 mt-0.5 ${answers.interestRate < 1 ? "text-red-600" : "text-amber-600"}`} />
                                  <div className="space-y-1">
                                    <p className={`text-xs font-semibold ${answers.interestRate < 1 ? "text-red-900" : "text-amber-900"}`}>
                                      {answers.interestRate < 1 ? "Very Low Rate — ASPE 3856 FV Adjustment Required" : "Low Rate — ASPE 3856 FV Adjustment May Be Required"}
                                    </p>
                                    <p className={`text-xs ${answers.interestRate < 1 ? "text-red-800" : "text-amber-800"}`}>
                                      The rate of {answers.interestRate.toFixed(2)}% is below market. After classification, the loan/lease detail page will suggest a fair value rate (prime + 2%) for ASPE 3856 compliance.
                                    </p>
                                  </div>
                                </div>
                              )}

                              <div className="flex items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-8 gap-1"
                                  disabled={answers.fairValue <= 0 || answers.monthlyPayment <= 0 || answers.termMonths <= 0}
                                  onClick={() => setShowImplicitRateDialog(true)}
                                >
                                  <Calculator className="h-3.5 w-3.5" />
                                  Calculate Implicit Rate
                                </Button>
                                {answers.fairValue <= 0 || answers.monthlyPayment <= 0 || answers.termMonths <= 0 ? (
                                  <span className="text-xs text-muted-foreground">Enter payment, fair value, and term first</span>
                                ) : null}
                              </div>

                              {/* IBR Guidance */}
                              <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
                                <p className="text-sm font-semibold text-blue-900">How to Determine the Right Rate</p>
                                <p className="text-xs text-blue-800 leading-relaxed">
                                  ASPE requires the <strong>lower</strong> of the lease's implicit rate, if determinable, and the lessee's supported incremental borrowing rate (IBR). If the implicit rate cannot be determined, use the supported IBR. If neither is supported, keep the assessment in review.
                                </p>
                                <div className="space-y-2 mt-2">
                                  <div className="p-2 rounded bg-white/60 border border-blue-100">
                                    <p className="text-xs font-semibold text-blue-900">1. Incremental Borrowing Rate (IBR)</p>
                                    <p className="text-xs text-blue-800">
                                      The rate the lessee would pay to borrow funds to buy this asset, with similar collateral and term. Here's how to estimate it:
                                    </p>
                                    <ul className="text-xs text-blue-800 list-disc list-inside mt-1 space-y-0.5">
                                      <li><strong>Has existing debt?</strong> Use the weighted average interest rate on current loans (bank term loans, lines of credit, mortgages).</li>
                                      <li><strong>No existing debt?</strong> Use the rate a bank would offer for a similar secured loan. A reasonable proxy: current prime rate + 2% to 4% depending on creditworthiness.</li>
                                      <li><strong>Vehicle lease?</strong> Many captive finance companies (e.g., Toyota Financial) publish lease rates in the 3%–8% range. Use the higher end if the lessee has average credit.</li>
                                      <li><strong>Equipment lease?</strong> Independent lessors typically charge 6%–12%. A 7-year term might be at the higher end.</li>
                                    </ul>
                                  </div>
                                  <div className="p-2 rounded bg-white/60 border border-blue-100">
                                    <p className="text-xs font-semibold text-blue-900">2. Safe Default (if uncertain)</p>
                                    <p className="text-xs text-blue-800">
                                      Obtain a supported rate for similar financing from a lender quote or comparable borrowing terms. Document the source and date. Do not choose a rate to obtain a preferred classification; if support is missing, keep the assessment in review.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {/* Calculated Result */}
                            <LeasePaymentTest conclusion={paymentTest} />
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Label htmlFor={c.key}>{c.thresholdLabel}</Label>
                            <Input disabled={readOnly}
                              id={c.key}
                              type="number"
                              step="0.01"
                              min={c.min}
                              max={c.max}
                              value={answerVal as number}
                              onChange={(e) => updateNumber(c.key as "pvPctFairValue" | "fairValue", Number(e.target.value))}
                              placeholder={`Enter a value (threshold: ${c.threshold}${c.unit})`}
                            />
                            <p className="text-xs text-muted-foreground">
                              Threshold: {c.threshold}{c.unit} or greater for this criterion to be met
                            </p>
                          </div>
                        )}
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 text-sm">
                          {c.key === "pvPctFairValue" && !paymentTest.minimum ? <span>Review the rental terms, ending amount, fair value and discount rate to run this test.</span> : (answerVal as number) >= (c.threshold ?? 0) ? (
                            <>
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              <span>This criterion is <strong>met</strong> ({displayVal}{c.unit}{" >= "}{c.threshold}{c.unit})</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-4 w-4 text-muted-foreground" />
                              <span>This criterion is <strong>not met</strong> ({displayVal}{c.unit}{" < "}{c.threshold}{c.unit})</span>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* Step 6: Conclusion */}
        {step === 6 && (
          <div className="space-y-4 py-2">
            <Card className={result.isCapitalLease ? "border-emerald-300 bg-emerald-50/50" : "border-amber-300 bg-amber-50/50"}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {result.isCapitalLease ? (
                    <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                  )}
                  <p className="font-semibold font-display">
                    {conclusion.status === "needs_review" ? "Not ready to conclude — needs review" : result.isCapitalLease ? "Yes — capital lease" : "No — operating lease"}
                  </p>
                </div>
                <p className="text-sm text-muted-foreground">{result.rationale}</p>
                <p className="text-xs">{conclusion.status === "needs_review" ? "Next: resolve the missing or conflicting evidence below. Classification cannot be confirmed yet." : "Not yet confirmed. Check the supporting evidence, then confirm to continue."}</p>
              </CardContent>
            </Card>
            <LeasePaymentTest conclusion={conclusion} />

            <LeaseReviewDetails title="Classification tests and evidence" needsAttention={conclusion.status === "needs_review"}>
              {rent && <p className="text-xs">Supplementary rent-only comparison: {percentLabel(rent.percent)}% of fair value. This excludes ending amounts and is not the formal minimum lease payments test.</p>}
              {CRITERIA.map((c) => {
                let met = false;
                if (c.isYesNo) {
                  met = answers[c.key] as boolean;
                } else {
                  met = (answers[c.key] as number) >= (c.threshold ?? 0);
                }
                return (
                  <div key={c.key} className="flex items-start justify-between gap-3 text-sm py-1 border-b last:border-0">
                    <span className="flex items-start gap-2">
                      {met ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : (
                        <HelpCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                      {c.title}
                    </span>
                    <span className={met ? "text-emerald-600 font-medium" : "text-muted-foreground"}>
                      {c.isYesNo
                        ? (answers[c.key] ? "Yes" : "No")
                        : (c.key === "pvPctFairValue" && !paymentTest.minimum || c.key === "leaseTermPct" && conclusion.lifePercent == null ? "Unavailable" : `${c.key === "pvPctFairValue" ? percentLabel(answers.pvPctFairValue) : answers[c.key]}${c.unit}`)}
                    </span>
                  </div>
                );
              })}
            </LeaseReviewDetails>
            <LeaseEndingFields value={answers.leaseEndingTerms} months={answers.termMonths} readOnly={readOnly} onChange={leaseEndingTerms => setAnswers(prev => ({ ...prev, leaseEndingTerms }))} />

            {conclusion.status === "operating" && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium">Operating Lease Classification</p>
                  <p>No capital lease criteria were met. Under ASPE 3065, treat this as an operating lease.</p>
                  <p className="text-muted-foreground">Next: confirm classification, then review rent expense, rent-free periods and any landlord incentives. Review your answers if you believe a capital classification basis should be met.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 7: Lease Terms & Inducements (operating lease only) */}
        {step === 7 && (
          <div className="space-y-5 py-2">
            {(answers.assetType === "office_commercial" || answers.assetType === "building_industrial") ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm">
                <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5" />
                <div className="space-y-2">
                  <p className="font-medium">Straight-Line Lease Adjustments — Watch for Inducements</p>
                  <p>Operating leases are expensed on a straight-line basis over the lease term. When there are rent escalations, free-rent periods, tenant improvement allowances, or other inducements, the total rent is smoothed equally across all months. The difference between cash rent and straight-line rent creates a <strong>deferred rent asset or liability</strong> on the balance sheet.</p>
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-0.5">
                    <li>Free rent periods (e.g. first 3 months rent-free)</li>
                    <li>Annual rent escalations (fixed % or CPI-linked)</li>
                    <li>Tenant improvement allowances (cash or reimbursement for build-out)</li>
                    <li>Signing bonuses or moving cost reimbursements</li>
                  </ul>
                  <p className="text-xs text-muted-foreground">Leave all fields at zero if the lease has no inducements and rent is flat throughout the term.</p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-sm">
                <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-medium">Straight-Line Lease Adjustments</p>
                  <p>Operating leases are expensed on a straight-line basis over the lease term. When there are rent escalations, free-rent periods, tenant improvement allowances, or other inducements, the total rent is smoothed equally across all months. The difference between cash rent and straight-line rent creates a <strong>deferred rent asset or liability</strong> on the balance sheet. Leave all fields at zero if the lease has no inducements and rent is flat throughout the term.</p>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="freeRentMonths">Free Rent Period (months)</Label>
              <Input disabled={readOnly}
                id="freeRentMonths"
                type="number"
                min={0}
                value={straightLine.freeRentMonths || ""}
                onChange={(e) =>
                  setStraightLine((prev) => ({ ...prev, freeRentMonths: Number(e.target.value) }))
                }
                placeholder="e.g. 3"
              />
              <p className="text-xs text-muted-foreground">Months at the start of the lease where no rent is payable. Common inducement in property leases.</p>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>Stepped Rent Schedule ($ per month)</Label>
                <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={() => setStraightLine((prev) => {
                      const last = prev.rentSteps[prev.rentSteps.length - 1];
                      const nextFrom = last ? last.toYear + 1 : 1;
                      return {
                        ...prev,
                        rentSteps: [...prev.rentSteps, { fromYear: nextFrom, toYear: nextFrom, monthlyRent: 0 }],
                      };
                    })
                  }
                >
                  Add Step
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Most property leases state rent increases in dollars — e.g. Years 1–2: $7,466.67/month, Years 3–4:
                $8,000/month. Enter each rent level and the lease years it covers. If the lease is quoted per square
                foot per year, multiply by the area and divide by 12. When steps are entered, the escalation % below
                is ignored.
              </p>
              {straightLine.rentSteps.length > 0 && (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 text-xs text-muted-foreground font-medium">
                    <span>From year</span>
                    <span>To year</span>
                    <span>Monthly rent ($)</span>
                    <span />
                  </div>
                  {straightLine.rentSteps.map((s, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1.5fr_auto] gap-2 items-center">
                      <Input disabled={readOnly}
                        type="number"
                        min={1}
                        value={s.fromYear || ""}
                        onChange={(e) =>
                          setStraightLine((prev) => ({
                            ...prev,
                            rentSteps: prev.rentSteps.map((r, j) =>
                              j === i ? { ...r, fromYear: Number(e.target.value) } : r,
                            ),
                          }))
                        }
                      />
                      <Input disabled={readOnly}
                        type="number"
                        min={1}
                        value={s.toYear || ""}
                        onChange={(e) =>
                          setStraightLine((prev) => ({
                            ...prev,
                            rentSteps: prev.rentSteps.map((r, j) =>
                              j === i ? { ...r, toYear: Number(e.target.value) } : r,
                            ),
                          }))
                        }
                      />
                      <Input disabled={readOnly}
                        type="number"
                        min={0}
                        step="0.01"
                        value={s.monthlyRent || ""}
                        placeholder="e.g. 7466.67"
                        onChange={(e) =>
                          setStraightLine((prev) => ({
                            ...prev,
                            rentSteps: prev.rentSteps.map((r, j) =>
                              j === i ? { ...r, monthlyRent: Number(e.target.value) } : r,
                            ),
                          }))
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setStraightLine((prev) => ({
                            ...prev,
                            rentSteps: prev.rentSteps.filter((_, j) => j !== i),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="rentEscalationRate">Rent Escalation Rate (annual %)</Label>
              <Input id="rentEscalationRate" type="number" step="0.01" min={0} disabled={readOnly || straightLine.rentSteps.length > 0}
                value={straightLine.rentEscalationRate || ""}
                onChange={(e) =>
                  setStraightLine((prev) => ({ ...prev, rentEscalationRate: Number(e.target.value) }))
                }
                placeholder="e.g. 2.5"
              />
              <p className="text-xs text-muted-foreground">
                {straightLine.rentSteps.length > 0
                  ? "Ignored while a stepped rent schedule is entered above."
                  : "Only for leases that state increases as a percentage (e.g. CPI-based). If the lease gives dollar amounts per year, use the stepped rent schedule above instead."}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tenantImprovementAllowance">Tenant Improvement Allowance ($)</Label>
              <Input disabled={readOnly}
                id="tenantImprovementAllowance"
                type="number"
                step="1"
                min={0}
                value={straightLine.tenantImprovementAllowance || ""}
                onChange={(e) =>
                  setStraightLine((prev) => ({ ...prev, tenantImprovementAllowance: Number(e.target.value) }))
                }
                placeholder="e.g. 25000"
              />
              <p className="text-xs text-muted-foreground">Amount provided by landlord for leasehold improvements. Treated as a reduction of total lease cost.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="otherInducements">Other Lease Inducements ($)</Label>
              <Input disabled={readOnly}
                id="otherInducements"
                type="number"
                step="1"
                min={0}
                value={straightLine.otherInducements || ""}
                onChange={(e) =>
                  setStraightLine((prev) => ({ ...prev, otherInducements: Number(e.target.value) }))
                }
                placeholder="e.g. 5000"
              />
              <p className="text-xs text-muted-foreground">Signing bonuses, moving allowances, or other incentives that reduce total lease cost. Deducted before straight-line calculation.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="camMonthly">Monthly CAM / Operating Costs ($)</Label>
              <Input disabled={readOnly}
                id="camMonthly"
                type="number"
                step="0.01"
                min={0}
                value={straightLine.camMonthly || ""}
                onChange={(e) =>
                  setStraightLine((prev) => ({ ...prev, camMonthly: Number(e.target.value) }))
                }
                placeholder="e.g. 1031.25"
              />
              <p className="text-xs text-muted-foreground">
                Common area maintenance, property taxes, and similar operating costs billed on top of base rent. These
                are executory costs — they are expensed as billed and kept out of the straight-line rent calculation
                and minimum lease payment disclosures. If quoted per square foot per year, multiply by the area and
                divide by 12.
              </p>
            </div>

            <div className="flex items-start gap-3 rounded-md border p-3">
              <Checkbox disabled={readOnly}
                id="inducementReceivedInCash"
                checked={straightLine.inducementReceivedInCash}
                onCheckedChange={(checked) =>
                  setStraightLine((prev) => ({ ...prev, inducementReceivedInCash: checked === true }))
                }
              />
              <div className="space-y-1">
                <Label htmlFor="inducementReceivedInCash">Inducement received in cash</Label>
                <p className="text-xs text-muted-foreground">
                  Check if the inducement was received as cash (shown as a financing inflow in the cash flow statement). Leave unchecked for non-cash inducements such as free rent or landlord-provided tenant improvements, which are disclosed as a supplementary non-cash transaction.
                </p>
              </div>
            </div>

          </div>
        )}

        {step === 8 && (
          <div className="space-y-4 py-2" data-testid="capital-lease-measurement">
            <p className="text-xs font-medium">{!answers.leaseEndingTerms ? "Previous ending treatment retained" : answers.leaseEndingTerms.status !== "reviewed" ? "Calculation draft — ending evidence needs review" : "Ending evidence reviewed — check amounts before continuing"}</p>
            <LeaseOpeningSummary pvValue={result.pvValue} fairValue={answers.fairValue} downPayment={answers.downPayment} ending={answers.leaseEndingTerms} classificationChanged={changedSinceConclusion || !result.isCapitalLease} />
            <p className="text-sm"><strong>Asset amortization period:</strong> {answers.transferOfOwnership || answers.bargainPurchaseOption
              ? `${answers.economicLife} years — economic life, because ownership transfers or there is a bargain purchase option.`
              : `${answers.termMonths} months — lease term, because ownership does not transfer and there is no bargain purchase option.`}</p>
            <LeaseReviewDetails title="Rent payments and calculation inputs">
              <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Monthly rent used (after tax and services)</dt><dd>{formatCurrency(preTaxMonthlyPayment(answers))}</dd></div>
                <div><dt className="text-muted-foreground">Discount rate used</dt><dd>{assessmentRate(answers)}%</dd></div>
                <div><dt className="text-muted-foreground">Lease term</dt><dd>{answers.termMonths} months</dd></div>
                <div><dt className="text-muted-foreground">Asset fair value at the start</dt><dd>{formatCurrency(answers.fairValue)}</dd></div>
                <div><dt className="text-muted-foreground">Rent due</dt><dd>{answers.paymentAtBeginning ? "At the start of each period" : "At the end of each period"}</dd></div>
                <div><dt className="text-muted-foreground">Separate upfront payment</dt><dd>{formatCurrency(answers.downPayment)}</dd></div>
              </dl>
              {answers.firstPaymentAmount != null && <p className="text-sm">First rent used (after tax and services): <strong>{formatCurrency(financingFirstPayment(answers) ?? 0)}</strong>. This replaces the first regular rent; it is not an extra payment.</p>}
              <p className="text-xs text-muted-foreground">To change rent, term, fair value or payment timing, go Back to the assessment and use Back to reach the relevant question. Changes require classification to be confirmed again.</p>
            </LeaseReviewDetails>
            <LeaseEndingFields value={answers.leaseEndingTerms} months={answers.termMonths} readOnly={readOnly} onChange={leaseEndingTerms => setAnswers(prev => ({ ...prev, leaseEndingTerms }))} />
          </div>
        )}
        {step === 7 && answers.leaseEndingTerms && <LeaseEndingFields value={answers.leaseEndingTerms} months={answers.termMonths} readOnly={readOnly} onChange={leaseEndingTerms => setAnswers(prev => ({ ...prev, leaseEndingTerms }))} />}
        {changedSinceConclusion && <p role="alert" className="text-sm text-amber-800">These changes affect the assessment. Go back and confirm the classification before saving.</p>}
        </DialogBody>
        <DialogFooter className="shrink-0 border-t pt-3 gap-2">
          <div className="flex flex-wrap gap-2 w-full sm:justify-end [&>button]:min-h-11 [&>button]:h-auto [&>button]:whitespace-normal [&>button]:py-2">
            {step > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  if (step === 8) {
                    setStep(6);
                  } else {
                    setStep((s) => s - 1);
                  }
                }}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
            )}
            {step > 0 && step < totalSteps - 1 && !(step === 6 && result.isCapitalLease) && (
              <Button onClick={() => { if (step === 6) setConfirmedAssessment(assessmentKey); setStep(s => s + 1); }} disabled={!canProceed()} className="gap-2">
                {step === 6 ? "Confirm classification & continue" : "Next"}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {step === 6 && result.isCapitalLease && <Button disabled={!canProceed()} onClick={() => { setConfirmedAssessment(assessmentKey); setStep(8); }}>Confirm classification &amp; calculate</Button>}
            {(step === totalSteps - 1 || step === 8) && (
              <Button disabled={readOnly || changedSinceConclusion || (step === 8 && !result.isCapitalLease)}
                onClick={() => {
                  onConfirm(result);
                  handleClose();
                }}
                className="gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                {finalAction === "save"
                  ? answers.leaseEndingTerms?.status === "draft" ? "Save draft lease changes" : "Save lease changes"
                  : answers.leaseEndingTerms?.status === "draft" ? "Continue with draft to lease form" : "Confirm & continue to lease form"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Implicit Rate Calculator Dialog */}
    <Dialog open={showImplicitRateDialog} onOpenChange={setShowImplicitRateDialog}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Calculate Implicit Rate
          </DialogTitle>
          <DialogDescription>
            Estimate the implicit rate from the asset's fair value, rentals and ending value. The ending amount's treatment in the 90% test depends on the reviewed lease terms.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Summary of known values */}
          <div className="p-3 rounded-lg bg-muted/30 space-y-1 text-sm">
            <p><strong>Fair Value:</strong> ${answers.fairValue.toLocaleString()}</p>
            <p><strong>Monthly Payment:</strong> ${answers.monthlyPayment.toLocaleString()}</p>
            {answers.downPayment > 0 && (
              <p><strong>Down Payment at Inception:</strong> ${answers.downPayment.toLocaleString()}</p>
            )}
            <p><strong>Lease Term:</strong> {answers.termMonths} months</p>
            <p><strong>Timing:</strong> {answers.paymentAtBeginning ? "First payment at inception" : "First payment after 30 days"}</p>
          </div>

          {/* Buyout input */}
          <div className="space-y-2">
            <Label htmlFor="dialogBuyout">Expected ending value used to estimate the rate ($)</Label>
            <Input disabled={readOnly}
              id="dialogBuyout"
              readOnly={hasPricingEnd}
              type="number"
              step="1"
              min={0}
              value={hasPricingEnd ? pricingEnd.amount ?? "" : answers.buyoutForImplicitRate || ""}
              onChange={(e) => updateNumber("buyoutForImplicitRate", Number(e.target.value))}
              placeholder="e.g. 10,000"
            />
            <p className="text-xs text-muted-foreground">
              {hasPricingEnd ? "Carried forward from the ending terms. Change the amount there if needed. " : "Enter a supported expected ending value for the rate estimate. "}
              A qualifying residual guarantee or bargain purchase price also belongs in minimum lease payments; an unguaranteed residual does not.
            </p>
            {pricingEnd.provisional && <p className="text-xs text-amber-800">Provisional rate estimate: confirm the ending terms, start date, taxes and services before approving the accounting. Calculating a rate does not confirm those answers.</p>}
          </div>

          {/* Formula explanation */}
          <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 space-y-2">
            <p className="text-sm font-semibold text-blue-900">What we're solving</p>
            <p className="text-xs text-blue-800">
              We find the rate where: <strong>PV of rent and the supported ending value = fair value</strong>
            </p>
            <p className="text-xs text-blue-800">
              This estimates an implicit rate from the inputs shown; it does not prove the lessor's actual internal rate. Use the lower of the determinable implicit rate and the client's supported borrowing rate.
            </p>
          </div>

          {/* Result */}
          {answers.fairValue > 0 && answers.monthlyPayment > 0 && answers.termMonths > 0 && (
            <div className="space-y-3">
              {(() => {
                const rate = calculateAssessmentImplicitRate(answers);
                if (rate == null || rate <= 0) return <p className="text-sm text-muted-foreground">No positive implicit rate could be calculated. Check the payment, ending value, timing and fair value.</p>;
                return (
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-50 border border-emerald-200">
                      <Calculator className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-emerald-900">Calculated Implicit Rate</p>
                        <p className="text-lg font-bold text-emerald-800">{Number(rate.toFixed(5))}% annually</p>
                      </div>
                    </div>
                    <Button
                      className="w-full gap-2"
                      onClick={() => {
                        setAnswers((prev) => applyCalculatedLeaseRate(prev, rate));
                        setShowImplicitRateDialog(false);
                      }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Use this rate
                    </Button>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
