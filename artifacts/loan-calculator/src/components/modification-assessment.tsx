import { useEffect, useMemo, useState } from "react";
import type { AgreementModificationAssessment, Loan } from "@workspace/api-client-react";
import { assessAspe3856Modification, assessLeaseChange, calculateProspectiveModificationSchedule, type Aspe3856DatedCashFlow } from "@workspace/amortization";
import { AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import type { LoanFormMode, LoanFormState } from "@/components/loan-form-fields";
import { calculateStraightLineLease } from "@/lib/straight-line";

type CashFlowDraft = { date: string; amount: string; description: string; sourceReference: string };
type ChangeDraft = { term: string; predecessorValue: string; successorValue: string; significance: string; sourceReference: string };

export interface ModificationAssessmentValue {
  predecessorAgreementId: string | null;
  modificationEffectiveDate: string | null;
  modificationAssessment: AgreementModificationAssessment | null;
  valid: boolean;
}

interface Props {
  agreements: Loan[];
  currentAgreementId?: string;
  successor: LoanFormState;
  mode: LoanFormMode;
  initialPredecessorId?: string | null;
  initialEffectiveDate?: string | null;
  initialAssessment?: AgreementModificationAssessment | null;
  onChange: (value: ModificationAssessmentValue) => void;
}

const blankFlow = (): CashFlowDraft => ({ date: "", amount: "", description: "", sourceReference: "" });
const blankChange = (): ChangeDraft => ({ term: "", predecessorValue: "", successorValue: "", significance: "", sourceReference: "" });
const RETAINED_COST_TERM = "Original instrument unamortized retained fees/costs";
const text = (value: unknown) => value == null || value === "" ? "—" : String(value);
const money = (value: unknown) => formatCurrency(Number(value ?? 0));
const restoreFlows = (flows: { date: string; amount: number; description: string; sourceReference: string }[] | undefined): CashFlowDraft[] =>
  flows?.length ? flows.map((flow) => ({ ...flow, amount: String(flow.amount), date: flow.date.slice(0, 10) })) : [blankFlow()];

function termsFor(loan: Loan | undefined, successor: LoanFormState): Array<[string, string, string]> {
  if (!loan) return [];
  return [
    ["Principal / total commitment", money(loan.principal), money(successor.principal)],
    ["Contractual rate", `${Number(loan.interestRate)}%`, `${Number(successor.interestRate || 0)}%`],
    ["Term", `${loan.termMonths ?? loan.termYears * 12} months`, `${successor.termMonths ?? successor.termYears * 12} months`],
    ["Payment", money(loan.monthlyPayment ?? loan.paymentOverride), money(successor.monthlyPayment ?? successor.paymentOverride)],
    ["Payment frequency", text(loan.paymentFrequency), text(successor.paymentFrequency)],
    ["Counterparty", text(loan.counterparty), text(successor.counterparty)],
  ];
}

export default function ModificationAssessment({
  agreements,
  currentAgreementId,
  successor,
  mode,
  initialPredecessorId,
  initialEffectiveDate,
  initialAssessment,
  onChange,
}: Props) {
  const initialPredecessor = agreements.find((item) => item.id === initialPredecessorId);
  const initialEffective = initialEffectiveDate?.split("T")[0] ?? successor.startDate;
  const operatingAtEffective = initialPredecessor && !initialPredecessor.isCapitalLease && initialPredecessor.monthlyPayment
    ? calculateStraightLineLease({
        baseMonthlyRent: Number(initialPredecessor.monthlyPayment),
        termMonths: initialPredecessor.termMonths ?? Math.round(initialPredecessor.termYears * 12),
        freeRentMonths: initialPredecessor.freeRentMonths,
        escalationRate: Number(initialPredecessor.rentEscalationRate),
        rentSteps: initialPredecessor.rentSteps,
        tenantImprovementAllowance: Number(initialPredecessor.tenantImprovementAllowance),
        otherInducements: Number(initialPredecessor.otherInducements),
        startDate: initialPredecessor.startDate,
        fiscalYearEnd: initialEffective,
      })
    : null;
  const computedAccumulatedDepreciation = initialPredecessor?.isCapitalLease && initialPredecessor.assetCost && initialPredecessor.assetUsefulLife && initialEffective
    ? Math.min(
        Number(initialPredecessor.assetCost),
        Number(initialPredecessor.assetCost) * Math.max(0,
          (new Date(`${initialEffective}T00:00:00`).getFullYear() - new Date(initialPredecessor.startDate).getFullYear()) * 12 +
          (new Date(`${initialEffective}T00:00:00`).getMonth() - new Date(initialPredecessor.startDate).getMonth()),
        ) / (initialPredecessor.assetUsefulLife * 12),
      )
    : 0;
  const [predecessorId, setPredecessorId] = useState(initialPredecessorId ?? "");
  const [effectiveDate, setEffectiveDate] = useState(initialEffectiveDate?.split("T")[0] ?? "");
  const [changes, setChanges] = useState<ChangeDraft[]>(() => {
    const restored = initialAssessment?.evidence?.contractualChanges?.filter((c) => c.term !== RETAINED_COST_TERM).map((c) => ({ ...c })) ?? [];
    return restored.length ? restored : [blankChange()];
  });
  const initialTest = initialAssessment?.evidence?.quantitativeTest;
  const [oldFlows, setOldFlows] = useState<CashFlowDraft[]>(() => restoreFlows(initialTest?.originalRemainingCashFlows));
  const [newFlows, setNewFlows] = useState<CashFlowDraft[]>(() => restoreFlows(initialTest?.modifiedCashFlows));
  const [carryingAmount, setCarryingAmount] = useState(() => initialTest?.carryingAmount?.toString() ?? "");
  const [sameDay, setSameDay] = useState<"include" | "exclude">(initialTest?.sameDayPaymentTreatment ?? "include");
  const [creditorFees, setCreditorFees] = useState(() => initialTest?.creditorFees?.toString() ?? "");
  const [otherCosts, setOtherCosts] = useState(() => initialTest?.otherTransactionCosts?.toString() ?? "");
  const [accruedInterest, setAccruedInterest] = useState(() => initialTest?.accruedInterest?.toString() ?? "");
  const [accruedTreatment, setAccruedTreatment] = useState<"included_in_carrying_amount" | "add_to_carrying_amount" | "exclude">(
    initialTest?.accruedInterestTreatment === "include_in_cash_flows" ? "exclude" : initialTest?.accruedInterestTreatment ?? "included_in_carrying_amount",
  );
  const facts = initialAssessment?.evidence?.facts;
  const [creditorChanged, setCreditorChanged] = useState(facts?.creditorChanged ?? false);
  const [legalDischarge, setLegalDischarge] = useState(facts?.legalDischarge ?? false);
  const [relatedParty, setRelatedParty] = useState(facts?.relatedParty ?? false);
  const [creditorEvidence, setCreditorEvidence] = useState(facts?.creditorChangedEvidence ?? "");
  const [dischargeEvidence, setDischargeEvidence] = useState(facts?.legalDischargeEvidence ?? "");
  const [relatedEvidence, setRelatedEvidence] = useState(facts?.relatedPartyEvidence ?? "");
  const transition = initialAssessment?.conclusion?.leaseTransition;
  const [leaseTerminated, setLeaseTerminated] = useState(transition?.originalLeaseTerminated ?? false);
  const [replacementLease, setReplacementLease] = useState(transition?.replacementLeaseExecuted ?? false);
  const [addsRight, setAddsRight] = useState(false);
  const [standalonePrice, setStandalonePrice] = useState(false);
  const [entryDate, setEntryDate] = useState(transition?.entryDate?.slice(0, 10) ?? initialEffective);
  const [debitAccount, setDebitAccount] = useState(transition?.debitAccount ?? "");
  const [creditAccount, setCreditAccount] = useState(transition?.creditAccount ?? "");
  const [entryAmount, setEntryAmount] = useState(transition?.amount?.toString() ?? "");
  const [entryEvidence, setEntryEvidence] = useState(transition?.entryEvidenceReference ?? "");
  const [terminationEvidence, setTerminationEvidence] = useState(transition?.terminationEvidenceReference ?? "");
  const [deferredRentAsset, setDeferredRentAsset] = useState(() => transition?.predecessorDeferredRentAsset?.toString() ?? String(Math.max(0, -(operatingAtEffective?.deferredRentAtYearEnd ?? 0))));
  const [deferredRentLiability, setDeferredRentLiability] = useState(() => transition?.predecessorDeferredRentLiability?.toString() ?? String(Math.max(0, operatingAtEffective?.deferredRentAtYearEnd ?? 0)));
  const [predecessorAssetCost, setPredecessorAssetCost] = useState(() => transition?.predecessorAssetCost?.toString() ?? String(Number(initialPredecessor?.assetCost ?? 0)));
  const [accumulatedDepreciation, setAccumulatedDepreciation] = useState(() => transition?.predecessorAccumulatedDepreciation?.toString() ?? String(computedAccumulatedDepreciation));
  const [successorInitialAmount, setSuccessorInitialAmount] = useState(() => transition?.successorInitialAmount?.toString() ?? String(Number(successor.principal ?? 0)));
  const [settlementConsideration, setSettlementConsideration] = useState(() => initialTest?.settlementConsideration?.toString() ?? "");
  const [retainedFeesAndCosts, setRetainedFeesAndCosts] = useState(() => initialTest?.retainedFeesAndCosts?.toString() ?? "");
  const [retainedFeesEvidence, setRetainedFeesEvidence] = useState(() =>
    initialTest?.retainedFeesAndCostsSourceReference
      ?? initialAssessment?.evidence?.contractualChanges?.find((change) => change.term === RETAINED_COST_TERM)?.sourceReference
      ?? "",
  );
  const [changeType, setChangeType] = useState<"renewal" | "modification">(
    initialAssessment?.conclusion?.agreementChangeType ?? "modification",
  );
  const [accountingTreatment, setAccountingTreatment] = useState<"continuation" | "extinguishment" | "new_lease" | "">(
    initialAssessment?.conclusion?.accountingTreatment ?? "",
  );
  const [rationale, setRationale] = useState(initialAssessment?.conclusion?.rationale ?? "");
  const [confirmedBy, setConfirmedBy] = useState(initialAssessment?.confirmedBy ?? "");
  const [confirmed, setConfirmed] = useState(initialAssessment?.status === "confirmed");

  const predecessor = agreements.find((item) => item.id === predecessorId);
  const isLease = mode !== "loan";
  const comparison = useMemo(() => termsFor(predecessor, successor), [predecessor, successor]);
  const originalEffectiveRate = predecessor
    ? predecessor.fvDecision === "use_fv" && predecessor.fvRate != null
      ? Number(predecessor.fvRate)
      : Number(predecessor.interestRate)
    : 0;

  const parsedNewFlows = useMemo<Aspe3856DatedCashFlow[]>(() =>
    newFlows.filter((f) => f.date && Number(f.amount) >= 0).map((f) => ({
      date: new Date(`${f.date}T00:00:00`),
      amount: Number(f.amount),
      description: f.description,
      evidenceReference: f.sourceReference,
    })), [newFlows]);
  const parsedOldFlows = useMemo<Aspe3856DatedCashFlow[]>(() =>
    oldFlows.filter((f) => f.date && Number(f.amount) >= 0).map((f) => ({
      date: new Date(`${f.date}T00:00:00`),
      amount: Number(f.amount),
      description: f.description,
      evidenceReference: f.sourceReference,
    })), [oldFlows]);
  const debtResult = useMemo(() => {
    if (isLease || !effectiveDate || !(Number(carryingAmount) > 0) || !parsedOldFlows.length || !parsedNewFlows.length) return null;
    try {
      return assessAspe3856Modification({
        modificationDate: new Date(`${effectiveDate}T00:00:00`),
        carryingAmount: Number(carryingAmount),
        originalEffectiveRate,
        originalRemainingCashFlows: parsedOldFlows,
        modifiedCashFlows: parsedNewFlows,
        sameDayPaymentTreatment: sameDay,
        creditorFees: Number(creditorFees || 0),
        otherTransactionCosts: Number(otherCosts || 0),
        accruedInterest: Number(accruedInterest || 0),
        accruedInterestTreatment: accruedTreatment,
      }, {
        creditorChanged, legalDischarge, relatedParty,
        creditorEvidenceReference: creditorEvidence || undefined,
        legalEvidenceReference: dischargeEvidence || undefined,
        relatedPartyEvidenceReference: relatedEvidence || undefined,
      });
    } catch {
      return null;
    }
  }, [isLease, effectiveDate, carryingAmount, parsedOldFlows, parsedNewFlows, originalEffectiveRate, sameDay, creditorFees, otherCosts, accruedInterest, accruedTreatment, creditorChanged, legalDischarge, relatedParty, creditorEvidence, dischargeEvidence, relatedEvidence]);
  const prospectiveInputsComplete = !isLease &&
    accountingTreatment === "continuation" &&
    !!effectiveDate &&
    Number(carryingAmount) > 0 &&
    retainedFeesAndCosts !== "" &&
    Number(retainedFeesAndCosts) >= 0 &&
    newFlows.length > 0 &&
    newFlows.every((flow) => !!flow.date && flow.amount !== "" && Number(flow.amount) >= 0 && !!flow.description && !!flow.sourceReference);
  const prospectiveResult = useMemo(() => {
    if (!prospectiveInputsComplete) return null;
    try {
      return calculateProspectiveModificationSchedule({
        effectiveDate: new Date(`${effectiveDate}T00:00:00`),
        openingCarryingAmount: Number(carryingAmount),
        retainedFeesAndCosts: Number(retainedFeesAndCosts),
        newFeesAndCosts: Number(creditorFees || 0) + Number(otherCosts || 0),
        modifiedCashFlows: parsedNewFlows,
        sameDayPaymentTreatment: sameDay,
      });
    } catch {
      return null;
    }
  }, [prospectiveInputsComplete, effectiveDate, carryingAmount, retainedFeesAndCosts, creditorFees, otherCosts, parsedNewFlows, sameDay]);
  const prospectiveScheduleFailed = prospectiveInputsComplete && !prospectiveResult;

  const leaseResult = useMemo(() => {
    if (!isLease) return null;
    return assessLeaseChange({
      originalLeaseLegallyTerminated: leaseTerminated,
      replacementLeaseExecuted: replacementLease,
      addsRightOfUse: addsRight,
      addedConsiderationAtStandalonePrice: standalonePrice,
      relatedParty,
      transitionEntryEvidence: entryDate && debitAccount && creditAccount && Number(entryAmount) > 0 && entryEvidence ? {
        entryDate: new Date(`${entryDate}T00:00:00`),
        debitAccount,
        creditAccount,
        amount: Number(entryAmount),
        evidenceReference: entryEvidence,
      } : undefined,
    });
  }, [isLease, leaseTerminated, replacementLease, addsRight, standalonePrice, relatedParty, entryDate, debitAccount, creditAccount, entryAmount, entryEvidence]);

  const completedChanges = useMemo(() => changes.filter((c) => Object.values(c).every((v) => v.trim())), [changes]);
  const cashFlowEvidence = useMemo(() => [
    ...oldFlows.filter((f) => f.date && f.amount).map((f) => `Old cash flow ${f.date}: ${f.amount} — ${f.description} [${f.sourceReference}]`),
    ...newFlows.filter((f) => f.date && f.amount).map((f) => `New cash flow ${f.date}: ${f.amount} — ${f.description} [${f.sourceReference}]`),
  ], [oldFlows, newFlows]);
  // A linked lease agreement is documented here as an ASPE 3065 replacement:
  // old lease termination/derecognition followed by new commencement.
  const recommendation = isLease ? "new_lease" : debtResult?.recommendation;
  const newlyCompleted = !!(
    effectiveDate &&
    completedChanges.length > 0 &&
    completedChanges.length === changes.length &&
    (isLease || oldFlows.some((flow) => !!flow.date && !!flow.amount && !!flow.description && !!flow.sourceReference)) &&
    (isLease || newFlows.some((flow) => !!flow.date && !!flow.amount && !!flow.description && !!flow.sourceReference)) &&
    (isLease || debtResult) &&
    (isLease || accountingTreatment !== "continuation" || !!prospectiveResult) &&
    (isLease || (retainedFeesAndCosts !== "" && Number(retainedFeesAndCosts) >= 0 && !!retainedFeesEvidence.trim())) &&
    (!isLease || (leaseTerminated && replacementLease)) &&
    (!isLease || !!entryEvidence) &&
    (!isLease || !!terminationEvidence) &&
    (!isLease || entryDate === effectiveDate) &&
    (!isLease || (predecessor?.isCapitalLease
      ? Number(predecessorAssetCost) >= 0 && Number(accumulatedDepreciation) >= 0
      : Number(deferredRentAsset) >= 0 && Number(deferredRentLiability) >= 0)) &&
    (!isLease || mode !== "capital_lease" || Number(successorInitialAmount) > 0) &&
    (!creditorChanged || !!creditorEvidence.trim()) &&
    (!legalDischarge || !!dischargeEvidence.trim()) &&
    (!relatedParty || !!relatedEvidence.trim()) &&
    (!predecessor?.startDate || !effectiveDate || predecessor.startDate.slice(0, 10) <= effectiveDate) &&
    successor.startDate === effectiveDate &&
    (!leaseResult?.transitionEntryEvidenceRequired || leaseResult.transitionEntryEvidenceComplete) &&
    (isLease || accountingTreatment) &&
    (isLease || accountingTreatment !== "extinguishment" || Number(settlementConsideration) > 0) &&
    rationale.trim() &&
    confirmedBy.trim() &&
    confirmed
  );
  const valid = !predecessorId || newlyCompleted;

  useEffect(() => {
    if (!predecessorId) {
      onChange({ predecessorAgreementId: null, modificationEffectiveDate: null, modificationAssessment: null, valid: true });
      return;
    }
    const assessment: AgreementModificationAssessment | null = valid ? {
      status: "confirmed",
      assessmentDate: effectiveDate,
      confirmedAt: new Date().toISOString(),
      confirmedBy: confirmedBy.trim(),
      evidence: {
        changeSummary: `${changeType === "renewal" ? "Renewal" : "Modification"} of ${predecessor?.name ?? "selected predecessor"}; engine recommendation: ${recommendation}.`,
        contractualChanges: [
          ...completedChanges,
          ...(!isLease ? [{
            term: RETAINED_COST_TERM,
            predecessorValue: Number(retainedFeesAndCosts).toString(),
            successorValue: "Retained in continuing carrying basis",
            significance: "Existing instrument issuance fees/costs at the modification date; separate from current transaction costs.",
            sourceReference: retainedFeesEvidence.trim(),
          }] : []),
        ],
        qualitativeFactors: [
          `Accountant narrative: ${rationale.trim()}`,
          ...(debtResult?.recommendationReasons ?? leaseResult?.recommendationReasons ?? []),
        ],
        facts: {
          creditorChanged,
          creditorChangedEvidence: creditorChanged ? creditorEvidence.trim() : undefined,
          legalDischarge,
          legalDischargeEvidence: legalDischarge ? dischargeEvidence.trim() : undefined,
          relatedParty,
          relatedPartyEvidence: relatedParty ? relatedEvidence.trim() : undefined,
        },
        quantitativeTest: debtResult ? {
          method: `ASPE 3856 dated 10% test; Actual/365; original effective rate ${originalEffectiveRate}%${predecessor?.fvDecision === "use_fv" ? " (original FV effective rate)" : ""}`,
          originalEffectiveRate,
          carryingAmount: Number(carryingAmount),
          originalRemainingCashFlows: oldFlows.map((f) => ({ date: f.date, amount: Number(f.amount), description: f.description, sourceReference: f.sourceReference })),
          modifiedCashFlows: newFlows.map((f) => ({ date: f.date, amount: Number(f.amount), description: f.description, sourceReference: f.sourceReference })),
          sameDayPaymentTreatment: sameDay,
          creditorFees: Number(creditorFees || 0),
          otherTransactionCosts: Number(otherCosts || 0),
          accruedInterest: Number(accruedInterest || 0),
          accruedInterestTreatment: accruedTreatment,
          predecessorAmount: debtResult.tenPercentTest.presentValueOfOriginalRemainingCashFlows,
          successorAmount: debtResult.tenPercentTest.presentValueOfModifiedCashFlows,
          presentValueOfOriginalRemainingCashFlows: debtResult.tenPercentTest.presentValueOfOriginalRemainingCashFlows,
          presentValueOfModifiedCashFlows: debtResult.tenPercentTest.presentValueOfModifiedCashFlows,
          differenceAmount: debtResult.tenPercentTest.difference,
          differencePercent: debtResult.tenPercentTest.differencePercent,
          retainedFeesAndCosts: Number(retainedFeesAndCosts),
          retainedFeesAndCostsSourceReference: retainedFeesEvidence.trim(),
          newFeesAndCosts: Number(creditorFees || 0) + Number(otherCosts || 0),
          ...(accountingTreatment === "extinguishment" ? { settlementConsideration: Number(settlementConsideration) } : {}),
          recommendation: debtResult.recommendation,
        } : null,
      },
      conclusion: {
        agreementChangeType: changeType,
        accountingTreatment: (isLease ? "new_lease" : accountingTreatment) as "continuation" | "extinguishment" | "new_lease",
        rationale: rationale.trim(),
        ...(isLease ? {
          leaseTransition: {
            predecessorLeaseType: predecessor?.isCapitalLease ? "capital" : "operating",
            originalLeaseTerminated: leaseTerminated,
            replacementLeaseExecuted: replacementLease,
            terminationEvidenceReference: terminationEvidence.trim(),
            entryDate,
            debitAccount: debitAccount.trim(),
            creditAccount: creditAccount.trim(),
            amount: Number(entryAmount),
            entryEvidenceReference: entryEvidence.trim(),
            predecessorDeferredRentAsset: predecessor?.isCapitalLease ? null : Number(deferredRentAsset),
            predecessorDeferredRentLiability: predecessor?.isCapitalLease ? null : Number(deferredRentLiability),
            predecessorAssetCost: predecessor?.isCapitalLease ? Number(predecessorAssetCost) : null,
            predecessorAccumulatedDepreciation: predecessor?.isCapitalLease ? Number(accumulatedDepreciation) : null,
            successorInitialAmount: mode === "capital_lease" ? Number(successorInitialAmount) : 0,
          },
        } : {}),
      },
    } : null;
    onChange({
      predecessorAgreementId: predecessorId,
      modificationEffectiveDate: effectiveDate || null,
      modificationAssessment: assessment,
      valid,
    });
  }, [predecessorId, effectiveDate, valid, confirmedBy, completedChanges, changeType, recommendation, sameDay, creditorFees, otherCosts, accruedInterest, accruedTreatment, creditorChanged, legalDischarge, relatedParty, creditorEvidence, dischargeEvidence, relatedEvidence, debtResult, leaseResult, isLease, originalEffectiveRate, predecessor, accountingTreatment, settlementConsideration, retainedFeesAndCosts, retainedFeesEvidence, rationale, terminationEvidence, deferredRentAsset, deferredRentLiability, predecessorAssetCost, accumulatedDepreciation, successorInitialAmount, mode, onChange]);

  const updateFlow = (setter: typeof setOldFlows, rows: CashFlowDraft[], index: number, patch: Partial<CashFlowDraft>) =>
    setter(rows.map((row, i) => i === index ? { ...row, ...patch } : row));

  return (
    <div className="space-y-5 rounded-lg border p-4" data-testid="panel-modification-assessment">
      <div>
        <h3 className="font-semibold">Renewal or modification assessment</h3>
        <p className="text-xs text-muted-foreground">Select a predecessor only when this agreement renews or changes it. The system never infers this link.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Predecessor agreement</Label>
          <Select value={predecessorId || "none"} onValueChange={(v) => setPredecessorId(v === "none" ? "" : v)}>
            <SelectTrigger data-testid="select-predecessor-agreement"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No predecessor</SelectItem>
              {agreements.filter((a) => a.id !== currentAgreementId).map((a) => <SelectItem key={a.id} value={a.id}>{a.name} — {a.startDate.slice(0, 10)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      {predecessorId && successor.startDate !== effectiveDate && <p className="text-sm text-amber-700"><AlertTriangle className="mr-1 inline h-4 w-4" />The modification effective date must equal this successor agreement's inception date ({successor.startDate || "not entered"}).</p>}
      {predecessorId && isLease && entryDate !== effectiveDate && <p className="text-sm text-amber-700"><AlertTriangle className="mr-1 inline h-4 w-4" />The lease transition entry date must equal the modification date.</p>}
        {predecessorId && <div className="space-y-2"><Label>Modification effective date</Label><Input data-testid="input-modification-effective-date" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} /></div>}
      </div>
      {predecessorId && !predecessor && <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="mr-2 inline h-4 w-4" />The linked predecessor is not loaded. Select an available agreement to complete this assessment.</div>}
      {predecessor && <>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm"><thead className="bg-muted/50"><tr><th className="p-2 text-left">Term</th><th className="p-2 text-left">Old</th><th className="p-2 text-left">New</th></tr></thead>
            <tbody>{comparison.map(([label, oldValue, newValue]) => <tr key={label} className="border-t"><td className="p-2 font-medium">{label}</td><td className="p-2">{oldValue}</td><td className="p-2">{newValue}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="space-y-2">
          <Label>Documented contractual changes</Label>
          {changes.map((row, i) => <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2 sm:grid-cols-5">
            {(["term", "predecessorValue", "successorValue", "significance", "sourceReference"] as const).map((key) => <Input key={key} data-testid={`input-change-${key}-${i}`} placeholder={({ term: "Term", predecessorValue: "Old value", successorValue: "New value", significance: "Significance", sourceReference: "Source / clause" })[key]} value={row[key]} onChange={(e) => setChanges(changes.map((c, n) => n === i ? { ...c, [key]: e.target.value } : c))} />)}
            {changes.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setChanges(changes.filter((_, n) => n !== i))} data-testid={`button-remove-change-${i}`}><Trash2 className="h-4 w-4" /></Button>}
          </div>)}
          <Button type="button" variant="outline" size="sm" onClick={() => setChanges([...changes, blankChange()])} data-testid="button-add-contractual-change"><Plus className="mr-1 h-4 w-4" />Add change</Button>
        </div>
        {!isLease && <div className="grid gap-4 lg:grid-cols-2">
          {([["Old remaining cash flows", oldFlows, setOldFlows], ["New contractual cash flows", newFlows, setNewFlows]] as const).map(([title, rows, setter]) => <div className="space-y-2" key={title}>
            <Label>{title}</Label>
            {rows.map((row, i) => <div key={i} className="grid grid-cols-2 gap-2 rounded-md border p-2">
              <Input type="date" value={row.date} onChange={(e) => updateFlow(setter, rows, i, { date: e.target.value })} data-testid={`input-${title.startsWith("Old") ? "old" : "new"}-flow-date-${i}`} />
              <Input type="number" min="0" step="0.01" placeholder="Amount" value={row.amount} onChange={(e) => updateFlow(setter, rows, i, { amount: e.target.value })} />
              <Input placeholder="Description" value={row.description} onChange={(e) => updateFlow(setter, rows, i, { description: e.target.value })} />
              <Input placeholder="Source / clause" value={row.sourceReference} onChange={(e) => updateFlow(setter, rows, i, { sourceReference: e.target.value })} />
            </div>)}
            <Button type="button" variant="outline" size="sm" onClick={() => setter([...rows, blankFlow()])}><Plus className="mr-1 h-4 w-4" />Add cash flow</Button>
          </div>)}
        </div>}
        {!isLease ? <>
          <div className="rounded-md border bg-muted/20 p-3 space-y-3">
            <div><p className="font-medium">ASPE 3856 reproducible 10% evidence</p><p className="text-xs text-muted-foreground">Discounted Actual/365 at the predecessor's original effective rate: <strong>{originalEffectiveRate}%{predecessor.fvDecision === "use_fv" ? " (FV rate)" : ""}</strong>.</p></div>
            <div className="grid gap-3 sm:grid-cols-3"><div><Label>Carrying amount before change</Label><Input type="number" min="0" value={carryingAmount} onChange={(e) => setCarryingAmount(e.target.value)} /></div><div><Label>Creditor fees (included)</Label><Input type="number" min="0" value={creditorFees} onChange={(e) => setCreditorFees(e.target.value)} /></div><div><Label>Other costs (excluded)</Label><Input type="number" min="0" value={otherCosts} onChange={(e) => setOtherCosts(e.target.value)} /></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label>Original unamortized retained fees/costs</Label><Input type="number" min="0" step="0.01" value={retainedFeesAndCosts} onChange={(e) => setRetainedFeesAndCosts(e.target.value)} placeholder="Enter 0 when none" /><p className="text-xs text-muted-foreground">Balance from the original instrument at the modification date; never inferred from current fees.</p></div><div><Label>Retained-fee source/evidence reference</Label><Input value={retainedFeesEvidence} onChange={(e) => setRetainedFeesEvidence(e.target.value)} placeholder="Ledger, agreement, or workpaper reference" /></div></div>
            <div className="grid gap-3 sm:grid-cols-2"><div><Label>Same-day scheduled payment</Label><Select value={sameDay} onValueChange={(v) => setSameDay(v as typeof sameDay)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="include">Include — still outstanding</SelectItem><SelectItem value="exclude">Exclude — already settled</SelectItem></SelectContent></Select></div><div><Label>Accrued interest</Label><div className="flex gap-2"><Input type="number" min="0" value={accruedInterest} onChange={(e) => setAccruedInterest(e.target.value)} /><Select value={accruedTreatment} onValueChange={(v) => setAccruedTreatment(v as typeof accruedTreatment)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="included_in_carrying_amount">Already in carrying amount</SelectItem><SelectItem value="add_to_carrying_amount">Add to carrying amount</SelectItem><SelectItem value="exclude">Exclude</SelectItem></SelectContent></Select></div></div></div>
            {debtResult && <div className={`rounded-md border p-3 ${debtResult.tenPercentTest.meetsTenPercentThreshold ? "border-amber-300 bg-amber-50" : "border-emerald-300 bg-emerald-50"}`} data-testid="result-ten-percent-test"><div className="grid grid-cols-4 gap-2 text-sm"><div>Original PV<br/><strong>{formatCurrency(debtResult.tenPercentTest.presentValueOfOriginalRemainingCashFlows)}</strong></div><div>Modified PV<br/><strong>{formatCurrency(debtResult.tenPercentTest.presentValueOfModifiedCashFlows)}</strong></div><div>Denominator<br/><strong>{formatCurrency(debtResult.tenPercentTest.presentValueOfOriginalRemainingCashFlows)}</strong></div><div>Absolute difference<br/><strong>{debtResult.tenPercentTest.differencePercent.toFixed(4)}%</strong></div></div></div>}
            {prospectiveScheduleFailed && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">Modified cash flows must include all remaining payments and maturity/balloon amounts sufficient to support the continuing carrying basis.</p>}
            {prospectiveResult && accountingTreatment === "continuation" && <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">Prospective continuation schedule solved successfully at an effective annual rate of <strong>{prospectiveResult.resultingEffectiveAnnualRate.toFixed(6)}%</strong>.</p>}
            <div className="rounded-md border bg-background p-3 text-sm"><p><strong>New fees and costs:</strong> {formatCurrency(Number(creditorFees || 0) + Number(otherCosts || 0))} = creditor fees {formatCurrency(Number(creditorFees || 0))} plus third-party costs {formatCurrency(Number(otherCosts || 0))}.</p><p className="mt-1 text-muted-foreground">10% test: creditor fees are included in modified cash flows; third-party costs are excluded. Entry basis: retained original costs of {formatCurrency(Number(retainedFeesAndCosts || 0))} remain separately identified; new fees/costs are applied according to the accountant's final continuation or extinguishment conclusion.</p>{accountingTreatment === "continuation" && Number(carryingAmount) > 0 && <p className="mt-1 font-medium">Indicative continuing carrying basis after fee/cost adjustments: {formatCurrency(Number(carryingAmount) - Number(retainedFeesAndCosts || 0) - Number(creditorFees || 0) - Number(otherCosts || 0))}</p>}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">{[["Creditor changed", creditorChanged, setCreditorChanged], ["Original legally discharged", legalDischarge, setLegalDischarge], ["Related party", relatedParty, setRelatedParty]] .map(([label, checked, setter]) => <label key={String(label)} className="flex items-center gap-2 rounded border p-2 text-sm"><Checkbox checked={checked as boolean} onCheckedChange={(v) => (setter as (v: boolean) => void)(v === true)} />{label as string}</label>)}</div>
        </> : <>
          <div className="rounded-md border bg-muted/20 p-3 space-y-3"><div><p className="font-medium">ASPE 3065 new lease conclusion</p><p className="text-xs text-muted-foreground">Document termination/derecognition of the old operating or capital lease and commencement of the new lease.</p></div>
            <div className="grid gap-2 sm:grid-cols-2">{[["Original lease legally terminated", leaseTerminated, setLeaseTerminated], ["Replacement lease executed", replacementLease, setReplacementLease], ["Adds a right of use", addsRight, setAddsRight], ["Added consideration at stand-alone price", standalonePrice, setStandalonePrice], ["Related party", relatedParty, setRelatedParty]] .map(([label, checked, setter]) => <label key={String(label)} className="flex items-center gap-2 text-sm"><Checkbox checked={checked as boolean} onCheckedChange={(v) => (setter as (v: boolean) => void)(v === true)} />{label as string}</label>)}</div>
            {(!leaseTerminated || !replacementLease) && <p className="text-sm text-amber-700"><AlertTriangle className="mr-1 inline h-4 w-4" />Confirm both termination of the original lease and execution of the replacement lease before saving the ASPE 3065 conclusion.</p>}
            <div className="grid gap-2 sm:grid-cols-2"><Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /><Input placeholder="Entry amount" type="number" value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} /><Input placeholder="Debit account (new commencement)" value={debitAccount} onChange={(e) => setDebitAccount(e.target.value)} /><Input placeholder="Credit account (termination / new obligation)" value={creditAccount} onChange={(e) => setCreditAccount(e.target.value)} /><Input className="sm:col-span-2" placeholder="Termination/replacement evidence reference" value={terminationEvidence} onChange={(e) => setTerminationEvidence(e.target.value)} /><Input className="sm:col-span-2" placeholder="Journal entry evidence reference" value={entryEvidence} onChange={(e) => setEntryEvidence(e.target.value)} /></div>
            <div className="space-y-2"><p className="text-xs font-medium text-muted-foreground">Predecessor balances immediately before the modification date (editable calculated defaults)</p>
              {predecessor?.isCapitalLease ? <div className="grid gap-2 sm:grid-cols-2"><div><Label>Leased asset cost</Label><Input type="number" min="0" value={predecessorAssetCost} onChange={(e) => setPredecessorAssetCost(e.target.value)} /></div><div><Label>Accumulated depreciation</Label><Input type="number" min="0" value={accumulatedDepreciation} onChange={(e) => setAccumulatedDepreciation(e.target.value)} /></div></div> : <div className="grid gap-2 sm:grid-cols-2"><div><Label>Deferred rent asset</Label><Input type="number" min="0" value={deferredRentAsset} onChange={(e) => setDeferredRentAsset(e.target.value)} /></div><div><Label>Deferred rent liability</Label><Input type="number" min="0" value={deferredRentLiability} onChange={(e) => setDeferredRentLiability(e.target.value)} /></div></div>}
              {mode === "capital_lease" && <div><Label>Successor initial capital lease amount</Label><Input type="number" min="0" value={successorInitialAmount} onChange={(e) => setSuccessorInitialAmount(e.target.value)} /></div>}
            </div>
          </div>
        </>}
        <div className="grid gap-2 sm:grid-cols-3"><Input placeholder="Creditor-change source reference" value={creditorEvidence} onChange={(e) => setCreditorEvidence(e.target.value)} /><Input placeholder="Legal-discharge source reference" value={dischargeEvidence} onChange={(e) => setDischargeEvidence(e.target.value)} /><Input placeholder="Related-party source reference" value={relatedEvidence} onChange={(e) => setRelatedEvidence(e.target.value)} /></div>
        <div className="rounded-md border p-3 text-sm" data-testid="result-modification-recommendation"><strong>Engine recommendation:</strong> {recommendation?.replaceAll("_", " ") ?? "Complete the evidence above"}</div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Agreement change</Label><Select value={changeType} onValueChange={(v) => setChangeType(v as typeof changeType)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="renewal">Renewal</SelectItem><SelectItem value="modification">Modification</SelectItem></SelectContent></Select></div><div>{isLease ? <><Label>ASPE 3065 accountant's conclusion</Label><div className="rounded border bg-muted/30 p-2 text-sm font-medium">New lease — termination/derecognition and new commencement</div></> : <><Label>Accountant's conclusion</Label><Select value={accountingTreatment} onValueChange={(v) => setAccountingTreatment(v as typeof accountingTreatment)}><SelectTrigger><SelectValue placeholder="Select independently..." /></SelectTrigger><SelectContent><SelectItem value="continuation">Continuation / modification accounting</SelectItem><SelectItem value="extinguishment">Extinguishment / derecognition</SelectItem></SelectContent></Select></>}</div></div>
        {!isLease && accountingTreatment === "extinguishment" && <div><Label>Settlement consideration at modification date</Label><Input type="number" min="0" step="0.01" value={settlementConsideration} onChange={(e) => setSettlementConsideration(e.target.value)} placeholder="Required; not inferred from present value" /><p className="text-xs text-muted-foreground">Enter the actual consideration transferred to settle the original obligation.</p></div>}
        <div><Label>Required rationale</Label><Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Explain the accountant's conclusion, including any departure from the recommendation." data-testid="input-modification-rationale" /></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label>Confirming accountant</Label><Input value={confirmedBy} onChange={(e) => setConfirmedBy(e.target.value)} placeholder="Full name" /></div><label className="flex items-center gap-2 self-end rounded border p-2 text-sm"><Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} data-testid="checkbox-accountant-confirmed" /><CheckCircle2 className="h-4 w-4" />I confirm this conclusion and evidence</label></div>
        {!valid && <p className="text-sm text-amber-700"><AlertTriangle className="mr-1 inline h-4 w-4" />This linked assessment is unresolved. Complete every evidence field before saving.</p>}
      </>}
    </div>
  );
}