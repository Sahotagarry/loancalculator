import { useAuth } from "@/hooks/use-auth";
import { useState, useMemo } from "react";
import { useRoute } from "wouter";
import { Link } from "wouter";
import { useGetLoan, getGetLoanQueryKey, useGetFile, useGetClient, useUpdateLoan, useGetPrimeRate, useListLoans, useListMasterAgreements, useCreateLoanEventSet, usePreviewLoanEventSet, getListLoanEventSetsQueryKey, useGetLoanRateTimeline, getGetLoanRateTimelineQueryKey, useOverrideLoanRate, useRestoreLoanSourcedRate, useGetFvDecisionHistory, getGetFvDecisionHistoryQueryKey, getListLoansQueryKey, useConfirmFvDecision, type LoanEventInput } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CounterpartyCombobox } from "@/components/counterparty-combobox";
import { SecurityCollateralFields } from "@/components/security-collateral-fields";
import { LoanFormFields, validateLoanForm, type LoanFormState, type LoanFormMode } from "@/components/loan-form-fields";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Area,
  Bar,
  BarChart,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import ConfirmDialog from "@/components/confirm-dialog";
import { FvDecisionPanel } from "@/components/fv-decision-panel";
import { ArrowLeft, Download, FileText, Calendar, Pencil, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, RotateCcw, DollarSign, TrendingDown, Clock, Percent, Star, ClipboardList, ChevronDown, ChevronUp, Paperclip } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import CapitalLeaseAssessment, { formatAssetType, parseAssetType, type AssessmentAnswers, type AssessmentResult, type StraightLineAnswers } from "@/components/capital-lease-assessment";
import { PageHeader } from "@/components/page-header";
import { calculateStraightLineLease, buildYearlyStraightLine } from "@/lib/straight-line";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { format, addYears, isAfter, addMonths, parseISO, subMonths, subDays } from "date-fns";
import {
  exportScheduleXlsx,
  exportSchedulePdf,
  exportAnnualXlsx,
  exportAnnualPdf,
  type LoanExportMeta,
} from "@/lib/loan-export";
import { buildLoanWorkpaper, exportLoanWorkpaperPdf, exportLoanWorkpaperXlsx } from "@/lib/workpaper-export";
import { runLoanDiagnostics } from "@/lib/diagnostics";
import { FindingsList } from "@/components/review-findings";
import { buildAssetDepreciationSchedule, isOperatingLeaseLoan, calculateBookedSchedule, buildFairValueAccountingEntries } from "@/lib/aspe-utils";
import { needsFvAssessment, needsUrgentFvAssessment } from "@/lib/fv-assessment";
import { resolveSuggestedFvRate, resolveEffectiveRate, parseFvRateInput, canSaveFvRate, resolveFvRateForDecision, isValidFvRate } from "@/lib/fv-rate";
import { getFiscalYear, getFyEndParts } from "@/lib/fiscal";
import { normalizeEventSequences } from "@/lib/import-events";
import ModificationAssessment, { type ModificationAssessmentValue } from "@/components/modification-assessment";

export default function LoanDetail() {
  const { canWrite } = useAuth();
  const [_, params] = useRoute("/client/:id/file/:fileId/loan/:loanId");
  const clientId = params?.id ?? "";
  const fileId = params?.fileId ?? "";
  const loanId = params?.loanId ?? "";

  const [tab, setTab] = useState("schedule");
  const [fvTab, setFvTab] = useState("actual");
  const [editOpen, setEditOpen] = useState(false);
  const [reevaluateOpen, setReevaluateOpen] = useState(false);
  const [adjEntryYear, setAdjEntryYear] = useState<number | null>(null);
  // Draft text for the editable fair-value rate input in the ASPE 3856 panel.
  // null means "not edited" — the input shows the current suggested/saved rate.
  const [eventEditorOpen, setEventEditorOpen] = useState(false);
  const [eventDraft, setEventDraft] = useState<LoanEventInput[]>([]);
  const [eventReason, setEventReason] = useState("");
  const [eventPreview, setEventPreview] = useState<any>(null);
  const [modification, setModification] = useState<ModificationAssessmentValue>({
    predecessorAgreementId: null,
    modificationEffectiveDate: null,
    modificationAssessment: null,
    valid: true,
  });

  const [editForm, setEditForm] = useState<LoanFormState>({
    name: "",
    description: "",
    counterparty: null as string | null,
    isCapitalLease: false,
    principal: 0,
    downPayment: 0,
    interestRate: 0,
    rateType: "fixed",
    rateBenchmark: null,
    contractualPrimeName: null,
    benchmarkEquivalentToContractualPrime: false,
    rateSpread: null,
    rateResetFrequency: null,
    rateEffectiveConvention: null,
    ratePaymentTreatment: null,
    initialFvRateAssumption: null,
    amortizationYears: 0,
    termYears: 0,
    startDate: "",
    paymentFrequency: "monthly",
    paymentTiming: "end",
    graceTermMode: "included",
    firstPaymentDate: "",
    firstPaymentDateDerived: true,
    semiMonthlyFirstDueDay: undefined,
    semiMonthlySecondDueDay: undefined,
    ioMonths: 0,
    graceMonths: 0,
    graceInterestTreatment: "capitalized",
    balloonPayment: 0,
    transferOfOwnership: false,
    bargainPurchaseOption: false,
    leaseTermPct: 0,
    pvPctFairValue: 0,
    fairValue: 0,
    specializedAsset: false,
    assetDescription: "",
    assetCost: 0,
    assetUsefulLife: 0,
    capitalLeaseRationale: "",
    monthlyPayment: undefined as number | undefined,
    paymentOverride: undefined as number | undefined,
    termMonths: undefined as number | undefined,
    isOfficeProperty: false,
    freeRentMonths: 0,
    rentEscalationRate: 0,
    rentSteps: [] as Array<{ fromYear: number; toYear: number; monthlyRent: number }>,
    tenantImprovementAllowance: 0,
    otherInducements: 0,
    inducementReceivedInCash: false,
    covenantViolation: false,
    fvRate: undefined as number | undefined,
    fvDecision: undefined as "use_fv" | "trivial" | "immaterial" | undefined,
    fvDecisionNote: "",
    securityClauses: [] as string[],
    collateralType: "",
    collateralDescription: "",
    collateralDepreciableCost: 0,
    collateralLandCost: 0,
    collateralInServiceDate: "",
    collateralMethod: "straight_line",
    collateralUsefulLifeYears: 0,
    collateralDecliningRate: 0,
    collateralSalvageValue: 0,
  });

  const { data: loan } = useGetLoan(loanId);
  const { data: fvDecisionHistory } = useGetFvDecisionHistory(loanId, { query: { enabled: !!loanId, queryKey: getGetFvDecisionHistoryQueryKey(loanId) } as any });
  const confirmFvDecision = useConfirmFvDecision({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetFvDecisionHistoryQueryKey(loanId) });
        queryClient.invalidateQueries({ queryKey: getGetLoanQueryKey(loanId) });
        queryClient.invalidateQueries({ queryKey: getListLoansQueryKey(fileId) });
        toast({ title: "Fair value decision confirmed" });
      },
      onError: (err) => {
        toast({ title: "Couldn't confirm decision", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const { data: linkedPredecessor } = useGetLoan(loan?.predecessorAgreementId ?? "", {
    query: {
      enabled: !!loan?.predecessorAgreementId,
      queryKey: getGetLoanQueryKey(loan?.predecessorAgreementId ?? ""),
      retry: false,
    },
  });

  const editMode: LoanFormMode = (() => {
    if (!loan) return "loan";
    if (loan.isCapitalLease) return "capital_lease";
    if (isOperatingLeaseLoan(loan)) return "operating_lease";
    return "loan";
  })();
  const { data: file } = useGetFile(fileId);
  const { data: client } = useGetClient(clientId);
  const { data: fileLoans } = useListLoans(fileId);
  const { data: masters } = useListMasterAgreements(fileId);

  const { data: rateTimeline, isLoading: isRateTimelineLoading } = useGetLoanRateTimeline(loanId, {
    query: { enabled: loan?.rateType === "prime_linked", queryKey: getGetLoanRateTimelineQueryKey(loanId) },
  });

  const overrideLoanRate = useOverrideLoanRate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLoanRateTimelineQueryKey(loanId) });
        queryClient.invalidateQueries({ queryKey: [`/api/loans/${loanId}`] });
        setOverrideOpen(false);
      },
      onError: (err) => {
        toast({ title: "Couldn't save override", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const restoreLoanRate = useRestoreLoanSourcedRate({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLoanRateTimelineQueryKey(loanId) });
        queryClient.invalidateQueries({ queryKey: [`/api/loans/${loanId}`] });
        setRestoreOpen(false);
      },
      onError: (err) => {
        toast({ title: "Couldn't restore rate", description: getErrorMessage(err), variant: "destructive" });
      }
    }
  });

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideRate, setOverrideRate] = useState<number | "">("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideUrl, setOverrideUrl] = useState("");

  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreDate, setRestoreDate] = useState("");


  const updateLoan = useUpdateLoan({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/loans/${loanId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/files/${fileId}/loans`] });
        setEditOpen(false);
      },
      onError: (err: any) => {
        if (err?.response?.status === 409 && err?.response?.data?.error?.includes("modification")) {
          toast({
            title: "Modification assessment required",
            description: "Existing prime-linked loans with applied history cannot directly change spread, reset basis, frequency, convention, treatment, or equivalence. To make these changes, you must initiate a modification assessment (Task 30). Ordinary overrides/restores remain available in the rate timeline.",
            variant: "destructive",
            duration: 10000,
          });
        } else {
          toast({ title: "Couldn't save changes", description: getErrorMessage(err), variant: "destructive" });
        }
      },
    },
  });
  const createEventSet = useCreateLoanEventSet({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/loans/${loanId}`] });
        queryClient.invalidateQueries({ queryKey: getListLoanEventSetsQueryKey(loanId) });
        setEventEditorOpen(false);
        toast({ title: "Principal payment events saved", description: "A successor event-set version was created." });
      },
      onError: (err: any) => {
        const conflict = err?.status === 409 || /version|conflict/i.test(getErrorMessage(err));
        toast({ title: conflict ? "Events changed elsewhere" : "Couldn't save events", description: conflict ? "Refresh the loan, review the current event set, then apply your changes again." : getErrorMessage(err), variant: "destructive" });
      },
    },
  });
  const previewEventSet = usePreviewLoanEventSet({ mutation: { onSuccess: setEventPreview, onError: (err) => toast({ title: "Couldn't preview events", description: getErrorMessage(err), variant: "destructive" }) } });

  const rate = Number(loan?.interestRate ?? 0);

  /* ── ASPE 3856 Fair Value ───────────────────────────────────── */
  const isLowRate = loan ? needsFvAssessment(loan) : false;
  const isVeryLowRate = loan ? needsUrgentFvAssessment(loan) : false;

  const { data: primeData } = useGetPrimeRate(
    isLowRate && loan ? { date: parseISO(loan.startDate).toISOString().split("T")[0] } : undefined,
    { query: { enabled: isLowRate && !!loan, queryKey: ["primeRate", loan?.startDate] } as any }
  );

  const suggestedFvRate = resolveSuggestedFvRate(loan?.fvRate, primeData?.suggestedRate);

  const effectiveRate = resolveEffectiveRate(loan?.fvDecision, suggestedFvRate, rate);

  const contractualResult = useMemo(() => {
    if (!loan) return null;
    return calculateBookedSchedule({
      ...loan,
      predecessorAgreement: linkedPredecessor as any,
      fvDecision: "contractual",
    });
  }, [loan, linkedPredecessor]);

  const fvResult = useMemo(() => {
    if (!loan || !contractualResult || !isValidFvRate(suggestedFvRate)) return null;
    // The shared booked-schedule path uses frozen recognition-date assumptions
    // for FV cash flows and live timeline evidence only for contractual rows.
    return calculateBookedSchedule({
      ...loan, predecessorAgreement: linkedPredecessor as any, fvDecision: "use_fv", fvRate: suggestedFvRate,
    });
  }, [loan, linkedPredecessor, contractualResult, suggestedFvRate]);

  // When fair value is adopted, the booked schedule is the effective-interest
  // schedule (contractual payments fixed, interest at the FV rate on the
  // discounted carrying amount) — never a re-amortization at the FV rate.
  const result = useMemo(() => {
    if (!loan || !contractualResult) return null;
    if (loan.fvDecision === "use_fv" && fvResult) return fvResult;
    return contractualResult;
  }, [loan, contractualResult, fvResult]);

  const fvDiff = useMemo(() => {
    if (!loan || !fvResult || fvResult.fairValue == null) return null;
    // Day-one fair-value adjustment = financed amount less the discounted fair value.
    return Number((Number(loan.principal) - Number(loan.downPayment ?? 0) - fvResult.fairValue).toFixed(2));
  }, [loan, fvResult]);

  const yearlyTotalsFv = useMemo(() => {
    if (!fvResult || !loan) return [];
    const fye = parseISO(loan.fiscalYearEnd);
    const yearEndMonth = fye.getUTCMonth();
    const yearEndDay = fye.getUTCDate();
    const totals: Record<string, { principal: number; interest: number; yearEnd: Date }> = {};
    fvResult.schedule.forEach((row) => {
      const date = row.date;
      let fiscalYear = date.getFullYear();
      const currentYearEnd = new Date(fiscalYear, yearEndMonth, yearEndDay);
      if (isAfter(date, currentYearEnd)) fiscalYear++;
      const key = fiscalYear.toString();
      if (!totals[key]) totals[key] = { principal: 0, interest: 0, yearEnd: new Date(fiscalYear, yearEndMonth, yearEndDay) };
      totals[key].principal += row.principal;
      totals[key].interest += row.interest;
    });
    return Object.entries(totals)
      .map(([year, data]) => ({ year: parseInt(year), label: `Year ending ${format(data.yearEnd, "MMMM d, yyyy")}`, ...data }))
      .sort((a, b) => a.year - b.year);
  }, [fvResult, loan]);

  // Periods that are the last payment within each fiscal year — emphasized in
  // the schedule table so year-end balances are easy to pick out.
  const fyeRowMonths = useMemo(() => {
    if (!result || !loan) return new Set<number>();
    const fye = parseISO(loan.fiscalYearEnd);
    const yearEndMonth = fye.getUTCMonth();
    const yearEndDay = fye.getUTCDate();
    const fiscalYearOf = (date: Date) => {
      let fy = date.getFullYear();
      if (isAfter(date, new Date(fy, yearEndMonth, yearEndDay))) fy++;
      return fy;
    };
    const months = new Set<number>();
    const sched = result.schedule;
    sched.forEach((row, i) => {
      const next = sched[i + 1];
      if (!next || fiscalYearOf(next.date) !== fiscalYearOf(row.date)) months.add(row.month);
    });
    return months;
  }, [result, loan]);

  const yearlyTotals = useMemo(() => {
    if (!result || !loan) return [];
    const fye = parseISO(loan.fiscalYearEnd);
    const yearEndMonth = fye.getUTCMonth();
    const yearEndDay = fye.getUTCDate();
    const totals: Record<string, { principal: number; interest: number; yearEnd: Date; opening: number; closing: number }> = {};

    result.schedule.forEach((row) => {
      const date = row.date;
      let fiscalYear = date.getFullYear();
      const currentYearEnd = new Date(fiscalYear, yearEndMonth, yearEndDay);
      if (isAfter(date, currentYearEnd)) fiscalYear++;
      const key = fiscalYear.toString();
      if (!totals[key]) {
        totals[key] = {
          principal: 0,
          interest: 0,
          yearEnd: new Date(fiscalYear, yearEndMonth, yearEndDay),
          // Balance before this period's payment = balance after + principal repaid.
          opening: row.balance + row.principal,
          closing: row.balance,
        };
      }
      totals[key].principal += row.principal;
      totals[key].interest += row.interest;
      totals[key].closing = row.balance;
    });

    return Object.entries(totals)
      .map(([year, data]) => ({
        year: parseInt(year),
        label: `Year ending ${format(data.yearEnd, "MMMM d, yyyy")}`,
        ...data,
      }))
      .sort((a, b) => a.year - b.year);
  }, [result, loan]);

  const yearlyTotalsActual = useMemo(() => {
    if (!contractualResult || !loan) return [];
    const fye = parseISO(loan.fiscalYearEnd);
    const yearEndMonth = fye.getUTCMonth();
    const yearEndDay = fye.getUTCDate();
    const totals: Record<string, { principal: number; interest: number; yearEnd: Date }> = {};

    contractualResult.schedule.forEach((row) => {
      const date = row.date;
      let fiscalYear = date.getFullYear();
      const currentYearEnd = new Date(fiscalYear, yearEndMonth, yearEndDay);
      if (isAfter(date, currentYearEnd)) fiscalYear++;
      const key = fiscalYear.toString();
      if (!totals[key]) {
        totals[key] = { principal: 0, interest: 0, yearEnd: new Date(fiscalYear, yearEndMonth, yearEndDay) };
      }
      totals[key].principal += row.principal;
      totals[key].interest += row.interest;
    });

    return Object.entries(totals)
      .map(([year, data]) => ({
        year: parseInt(year),
        label: `Year ending ${format(data.yearEnd, "MMMM d, yyyy")}`,
        ...data,
      }))
      .sort((a, b) => a.year - b.year);
  }, [contractualResult, loan]);

  const fvAccounting = useMemo(() => {
    if (!loan || !file?.fiscalYearEnd) return null;
    return buildFairValueAccountingEntries({
      loan: { ...loan, startDate: loan.startDate },
      reportingFiscalYearEnd: file.fiscalYearEnd,
      decisionHistory: fvDecisionHistory,
    });
  }, [loan, file, fvDecisionHistory]);


  const chartData = useMemo(() => {
    if (!result) return [];
    const step = Math.max(1, Math.floor(result.schedule.length / 120));
    return result.schedule
      .filter((_, i) => i % step === 0 || i === result.schedule.length - 1)
      .map((row) => ({
        ...row,
        dateLabel: format(row.date, "MMMM yyyy"),
        balanceLabel: formatCurrency(row.balance),
      }));
  }, [result]);

  const balanceTicks = useMemo(() => {
    if (!chartData.length) return [] as string[];
    const firstOfYear: string[] = [];
    let prevYear = "";
    for (const d of chartData) {
      const yr = d.dateLabel.split(" ")[1];
      if (yr !== prevYear) {
        firstOfYear.push(d.dateLabel);
        prevYear = yr;
      }
    }
    const maxLabels = 12;
    if (firstOfYear.length <= maxLabels) return firstOfYear;
    const stride = Math.ceil(firstOfYear.length / maxLabels);
    return firstOfYear.filter((_, i) => i % stride === 0);
  }, [chartData]);

  const chartStats = useMemo(() => {
    if (!result || !loan) return null;
    const sched = result.schedule;
    if (!sched.length) return null;
    const originalPrincipal = Number(loan.principal) - Number(loan.downPayment ?? 0);
    const totalInterest = sched[sched.length - 1].totalInterest;
    const totalPayments = sched.reduce((s, r) => s + r.payment, 0);
    const endingBalance = sched[sched.length - 1].balance;
    const interestPct = totalPayments > 0 ? (totalInterest / totalPayments) * 100 : 0;
    return { originalPrincipal, totalInterest, totalPayments, endingBalance, interestPct };
  }, [result, loan]);

  const annualChartData = useMemo(
    () =>
      yearlyTotals.map((y) => ({
        name: format(y.yearEnd, "yyyy"),
        label: y.label,
        principal: Number(y.principal.toFixed(2)),
        interest: Number(y.interest.toFixed(2)),
      })),
    [yearlyTotals]
  );

  const formatCompact = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  const annualTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    return (
      <div className="rounded-lg border bg-background p-3 shadow-md text-xs space-y-1 min-w-[180px]">
        <div className="font-semibold">{p.label}</div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--chart-1))" }} />Principal</span>
          <span className="font-medium">{formatCurrency(p.principal)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground"><span className="h-2 w-2 rounded-sm" style={{ background: "hsl(var(--primary))" }} />Interest</span>
          <span className="font-medium">{formatCurrency(p.interest)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-1">
          <span className="text-muted-foreground">Total payments</span>
          <span className="font-semibold">{formatCurrency(p.principal + p.interest)}</span>
        </div>
      </div>
    );
  };

  const balanceTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p = payload[0].payload;
    const rows: [string, string][] = [
      ["Outstanding balance", formatCurrency(p.balance)],
      ["Cumulative interest", formatCurrency(p.totalInterest)],
      ["Payment", formatCurrency(p.payment)],
      ["Principal", formatCurrency(p.principal)],
      ["Interest", formatCurrency(p.interest)],
    ];
    return (
      <div className="rounded-lg border bg-background p-3 shadow-md text-xs space-y-1 min-w-[190px]">
        <div className="font-semibold">{p.dateLabel}</div>
        {rows.map(([label, value], i) => (
          <div key={label} className={`flex items-center justify-between gap-4 ${i === 2 ? "border-t pt-1 mt-1" : ""}`}>
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>
    );
  };

  const assetDepreciation = useMemo(() => {
    if (!loan) return null;
    const { month, day } = getFyEndParts(loan.fiscalYearEnd);
    const reportFY = getFiscalYear(parseISO(loan.fiscalYearEnd), month, day);

    // Prefer the pledged collateral asset (same engine as the disclosed NBV).
    if (
      loan.collateralType &&
      loan.collateralType !== "land" &&
      Number(loan.collateralDepreciableCost ?? 0) > 0 &&
      loan.collateralInServiceDate
    ) {
      const rows = buildAssetDepreciationSchedule(
        Number(loan.collateralDepreciableCost),
        loan.collateralInServiceDate,
        loan.collateralMethod,
        loan.collateralUsefulLifeYears,
        Number(loan.collateralDecliningRate ?? 0),
        Number(loan.collateralSalvageValue ?? 0),
        month,
        day,
      );
      if (rows.length) {
        return {
          rows,
          reportFY,
          description:
            loan.collateralDescription?.trim() || loan.assetDescription || "Pledged asset",
          methodLabel:
            loan.collateralMethod === "declining_balance"
              ? `Declining balance at ${Number(loan.collateralDecliningRate ?? 0)}% per year`
              : `Straight-line over ${loan.collateralUsefulLifeYears} years`,
          cost: Number(loan.collateralDepreciableCost),
          salvage: Number(loan.collateralSalvageValue ?? 0),
          landCost:
            loan.collateralType === "land_and_building"
              ? Number(loan.collateralLandCost ?? 0)
              : 0,
        };
      }
    }

    // Fall back to the tracked asset (e.g. capital lease right-of-use asset),
    // amortized straight-line from the inception date.
    if (Number(loan.assetCost ?? 0) > 0 && (loan.assetUsefulLife ?? 0) > 0 && loan.startDate) {
      const rows = buildAssetDepreciationSchedule(
        Number(loan.assetCost),
        loan.startDate,
        "straight_line",
        loan.assetUsefulLife,
        0,
        0,
        month,
        day,
      );
      if (rows.length) {
        return {
          rows,
          reportFY,
          description: loan.assetDescription || "Amortized asset",
          methodLabel: `Straight-line over ${loan.assetUsefulLife} years`,
          cost: Number(loan.assetCost),
          salvage: 0,
          landCost: 0,
        };
      }
    }
    return null;
  }, [loan]);

  const exportEvidence = loan ? {
    ...loan,
    ...({ predecessorAgreement: linkedPredecessor } as any),
    principal: Number(loan.principal),
    interestRate: Number(loan.interestRate),
    termYears: loan.termYears,
    fvDecisionHistory,
    fairValueAccountingEntries: fvAccounting,
  } as unknown as LoanExportMeta : undefined;

  const downloadExcel = () => {
    if (!result) return;
    exportScheduleXlsx(loan?.name ?? "Loan", result.schedule, exportEvidence);
  };

  const downloadPDF = () => {
    if (!result || !exportEvidence) return;
    exportSchedulePdf(exportEvidence, result.schedule);
  };

  const downloadAnnualExcel = () => {
    if (!yearlyTotals.length) return;
    exportAnnualXlsx(loan?.name ?? "Loan", yearlyTotals, exportEvidence);
  };

  const downloadAnnualPDF = () => {
    if (!yearlyTotals.length || !loan) return;
    exportAnnualPdf(loan.name, yearlyTotals, exportEvidence);
  };

  const loanDiagnostics = useMemo(() => {
    if (!loan || !file?.fiscalYearEnd) return null;
    return runLoanDiagnostics(
      { ...loan, fvDecisionHistory },
      {
        id: file.id,
        clientId: file.clientId,
        fiscalYearEnd: file.fiscalYearEnd,
        trivialThreshold: file.trivialThreshold,
        materiality: file.materiality,
      }
    );
  }, [loan, file, fvDecisionHistory]);

  const setFindingDismissed = (findingId: string, dismiss: boolean) => {
    if (!canWrite) return;
    if (!loan) return;
    const current = loan.dismissedFindings ?? [];
    const next = dismiss ? Array.from(new Set([...current, findingId])) : current.filter((id) => id !== findingId);
    updateLoan.mutate({ id: loanId, data: { dismissedFindings: next } });
  };

  const openEditDialog = () => {
    if (!loan) return;
    setEditForm({
      name: loan.name,
      description: loan.description ?? "",
      counterparty: loan.counterparty ?? null,
      isCapitalLease: loan.isCapitalLease,
      principal: Number(loan.principal),
      downPayment: Number(loan.downPayment ?? 0),
      interestRate: Number(loan.interestRate),
      rateType: loan.rateType ?? "fixed",
      rateBenchmark: loan.rateBenchmark ?? null,
      contractualPrimeName: loan.contractualPrimeName ?? null,
      benchmarkEquivalentToContractualPrime: loan.benchmarkEquivalentToContractualPrime === true,
      rateSpread: loan.rateSpread != null ? Number(loan.rateSpread) : null,
      rateResetFrequency: loan.rateResetFrequency ?? null,
      rateEffectiveConvention: loan.rateEffectiveConvention ?? null,
      ratePaymentTreatment: loan.ratePaymentTreatment ?? null,
      initialFvRateAssumption: loan.initialFvRateAssumption ?? null,
      amortizationYears: loan.amortizationYears,
      termYears: loan.termYears,
      startDate: loan.startDate.split("T")[0],
      paymentFrequency: loan.paymentFrequency as any,
      paymentTiming: loan.paymentTiming ?? "end",
      graceTermMode: loan.graceTermMode ?? "included",
      firstPaymentDate: loan.firstPaymentDate ? loan.firstPaymentDate.split("T")[0] : "",
      firstPaymentDateDerived: false,
      semiMonthlyFirstDueDay: loan.semiMonthlyFirstDueDay ?? undefined,
      semiMonthlySecondDueDay: loan.semiMonthlySecondDueDay ?? undefined,
      ioMonths: loan.ioMonths,
      graceMonths: loan.graceMonths ?? 0,
      graceInterestTreatment: (loan.graceInterestTreatment as "capitalized" | "none") ?? "capitalized",
      balloonPayment: Number(loan.balloonPayment),
      transferOfOwnership: loan.transferOfOwnership,
      bargainPurchaseOption: loan.bargainPurchaseOption,
      leaseTermPct: Number(loan.leaseTermPct),
      pvPctFairValue: Number(loan.pvPctFairValue),
      fairValue: Number(loan.fairValue ?? 0),
      specializedAsset: loan.specializedAsset,
      assetDescription: loan.assetDescription ?? "",
      assetCost: Number(loan.assetCost ?? 0),
      assetUsefulLife: loan.assetUsefulLife ?? 0,
      capitalLeaseRationale: loan.capitalLeaseRationale ?? "",
      monthlyPayment: loan.monthlyPayment != null ? Number(loan.monthlyPayment) : undefined,
      paymentOverride: loan.paymentOverride != null ? Number(loan.paymentOverride) : undefined,
      termMonths: loan.termMonths ?? undefined,
      isOfficeProperty: loan.isOfficeProperty ?? false,
      freeRentMonths: loan.freeRentMonths ?? 0,
      rentEscalationRate: Number(loan.rentEscalationRate ?? 0),
      rentSteps: (loan.rentSteps as Array<{ fromYear: number; toYear: number; monthlyRent: number }> | undefined) ?? [],
      tenantImprovementAllowance: Number(loan.tenantImprovementAllowance ?? 0),
      otherInducements: Number(loan.otherInducements ?? 0),
      inducementReceivedInCash: loan.inducementReceivedInCash ?? false,
      covenantViolation: loan.covenantViolation ?? false,
      fvRate: loan.fvRate != null ? Number(loan.fvRate) : undefined,
      fvDecision: loan.fvDecision as "use_fv" | "trivial" | "immaterial" | undefined,
      fvDecisionNote: loan.fvDecisionNote ?? "",
      securityClauses: (loan.securityClauses as string[] | undefined) ?? [],
      collateralType: loan.collateralType ?? "",
      collateralDescription: loan.collateralDescription ?? "",
      collateralDepreciableCost: Number(loan.collateralDepreciableCost ?? 0),
      collateralLandCost: Number(loan.collateralLandCost ?? 0),
      collateralInServiceDate: loan.collateralInServiceDate ? loan.collateralInServiceDate.split("T")[0] : "",
      collateralMethod: loan.collateralMethod ?? "straight_line",
      collateralUsefulLifeYears: loan.collateralUsefulLifeYears ?? 0,
      collateralDecliningRate: Number(loan.collateralDecliningRate ?? 0),
      collateralSalvageValue: Number(loan.collateralSalvageValue ?? 0),
    });
    setModification({
      predecessorAgreementId: loan.predecessorAgreementId ?? null,
      modificationEffectiveDate: loan.modificationEffectiveDate ?? null,
      modificationAssessment: loan.modificationAssessment ?? null,
      valid: !loan.predecessorAgreementId || !!loan.modificationAssessment,
    });
    setEditOpen(true);
  };

  const downloadWorkpaper = (kind: "pdf" | "xlsx") => {
    if (!loan || !file?.fiscalYearEnd) return;
    // Pass the facility's master agreement so the workpaper carries the master
    // reference and security/covenant fallback wording.
    const master = loan.masterAgreementId
      ? (masters?.find((m) => m.id === loan.masterAgreementId) ?? null)
      : null;
    const wp = buildLoanWorkpaper({ ...loan, predecessorAgreement: linkedPredecessor, fvDecisionHistory, fairValueAccountingEntries: fvAccounting } as any, {
      clientName: client?.name ?? "Client",
      fiscalYearEnd: file.fiscalYearEnd,
    }, master);
    if (!wp) return;
    if (kind === "pdf") exportLoanWorkpaperPdf(wp);
    else exportLoanWorkpaperXlsx(wp);
  };

  if (!loan) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        backHref={`/client/${clientId}/file/${fileId}`}
        breadcrumb={
          <>
            <Link href="/" className="hover:text-foreground transition-colors font-semibold cursor-pointer">Clients</Link>
            <span className="text-border">/</span>
            <Link href={`/client/${clientId}`} className="hover:text-foreground transition-colors cursor-pointer">{client?.name ?? "Client"}</Link>
            <span className="text-border">/</span>
            <Link href={`/client/${clientId}/file/${fileId}`} className="hover:text-foreground transition-colors cursor-pointer">{file?.fiscalYearEnd ? format(parseISO(file.fiscalYearEnd), "MMM d, yyyy") + " FYE" : (file?.name ?? "Year-End File")}</Link>
            <span className="text-border">/</span>
            <span className="text-foreground font-semibold">{loan.name}</span>
          </>
        }
        title={loan.name}
        meta={
          <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hidden md:inline-flex">
            {(() => {
              const isOperatingLease = isOperatingLeaseLoan(loan);
              if (loan.isCapitalLease) return `Capital Lease — ${formatCurrency(Number(loan.principal))} at ${Number(loan.interestRate).toFixed(2)}%`;
              if (isOperatingLease) return `Operating Lease — ${formatCurrency(Number(loan.monthlyPayment ?? 0))}/mo`;
              return `Loan — ${formatCurrency(Number(loan.principal))} at ${Number(loan.interestRate).toFixed(2)}%`;
            })()}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {loan.sourceDocumentName && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="outline" size="sm" className="gap-2">
                    <a
                      href={`${import.meta.env.BASE_URL}api/loans/${loanId}/source-document`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Paperclip className="h-4 w-4" />
                      View Document
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open the original document: {loan.sourceDocumentName}</TooltipContent>
              </Tooltip>
            )}
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Calendar className="h-4 w-4" />
                      Schedule
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Download amortization schedule</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={downloadExcel}>
                  <Download className="h-4 w-4 mr-2" />
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={downloadPDF}>
                  <FileText className="h-4 w-4 mr-2" />
                  PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <ClipboardList className="h-4 w-4" />
                      Workpaper
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Export engagement workpaper (terms, continuity, disclosures, schedule)</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadWorkpaper("xlsx")}>
                  <Download className="h-4 w-4 mr-2" />
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => downloadWorkpaper("pdf")}>
                  <FileText className="h-4 w-4 mr-2" />
                  PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => openEditDialog()}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            </TooltipTrigger>
            <TooltipContent>Edit loan details</TooltipContent>
          </Tooltip>
          {(() => {
            const isLease = loan.isCapitalLease || (isOperatingLeaseLoan(loan));
            if (!isLease) return null;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => setReevaluateOpen(true)}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reevaluate Lease
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Re-run lease classification assessment</TooltipContent>
              </Tooltip>
            );
          })()}
          </div>
        }
      />
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {loan.predecessorAgreementId && !loan.modificationAssessment && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950" data-testid="status-modification-unresolved">
            <div><p className="font-semibold">Renewal/modification assessment required</p><p className="text-sm">This agreement has a predecessor link, but the evidence and accountant-confirmed conclusion are incomplete.</p></div>
            <Button variant="outline" onClick={openEditDialog} data-testid="button-complete-modification-assessment">Complete assessment</Button>
          </div>
        )}
        {loan.modificationAssessment && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950" data-testid="status-modification-confirmed">
            <p className="font-semibold">Modification assessment confirmed by {loan.modificationAssessment.confirmedBy}</p>
            <p>{loan.modificationAssessment.conclusion.accountingTreatment.replaceAll("_", " ")} — {loan.modificationAssessment.conclusion.rationale}</p>
          </div>
        )}
        <main className="space-y-6">
          {!isOperatingLeaseLoan(loan) && (
            <Card>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Mid-term Principal Payments</CardTitle>
                  <CardDescription>Immutable, ordered principal-only events used in this schedule.</CardDescription>
                </div>
                {canWrite && (
                <Button size="sm" variant="outline" onClick={() => {
                  setEventDraft(normalizeEventSequences((loan.activeEvents ?? []).map(({ id: _id, setId: _setId, loanId: _loanId, termRevisionId: _termId, ...event }) => event)));
                  setEventReason("");
                  setEventPreview(null);
                  setEventEditorOpen(true);
                }}>Manage payments</Button>
                )}
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {(loan.activeEvents ?? []).length === 0 ? <p className="text-muted-foreground">No active mid-term principal payments.</p> : (
                  <div className="rounded-md border divide-y">
                    {loan.activeEvents.map((event) => <div key={event.id} className="p-2 grid grid-cols-1 md:grid-cols-4 gap-1">
                      <span>{format(parseISO(event.effectiveDate), "MMM d, yyyy")} · {formatCurrency(Number(event.amount))}</span>
                      <span className="text-muted-foreground">{event.ordering === "before_scheduled_payment" ? "Before payment" : "After payment"} · #{event.sequence}</span>
                      <span>{event.treatment === "keep_maturity" ? "Keep maturity / recast" : "Keep payment / earlier payoff"}</span>
                      <span className="text-muted-foreground">{event.source}: {event.reason}</span>
                    </div>)}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Revision {loan.currentRevisionId ?? "—"} · event set {loan.activeEventSetId ?? "—"} v{loan.activeEventSetVersion} · {loan.activeEventSetHash ?? "no fingerprint"}</p>
              </CardContent>
            </Card>
          )}
          {/* Quick Stats */}
          {result && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <DollarSign className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">
                      {Number(loan.downPayment ?? 0) > 0 ? "Amount Financed" : "Original Amount"}
                    </p>
                    <p className="text-lg font-bold text-foreground">
                      {formatCurrency(Number(loan.principal) - Number(loan.downPayment ?? 0))}
                    </p>
                    {Number(loan.downPayment ?? 0) > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {formatCurrency(Number(loan.principal))} less {formatCurrency(Number(loan.downPayment))} down
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-muted border flex items-center justify-center">
                    <TrendingDown className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Monthly Payment</p>
                    <p className="text-lg font-bold text-foreground">
                      {formatCurrency(result.monthlyPayment)}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-muted border flex items-center justify-center">
                    <Percent className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Effective Rate</p>
                    <p className="text-lg font-bold text-foreground">
                      {effectiveRate.toFixed(2)}%
                      {loan.fvDecision === "use_fv" && <Star className="inline h-3 w-3 ml-1 text-amber-500" />}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Payment Periods</p>
                    <p className="text-lg font-bold text-foreground">{result.schedule.length}</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Review / Diagnostics */}
          {loanDiagnostics && (loanDiagnostics.findings.length > 0 || loanDiagnostics.dismissed.length > 0) && (
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    Review Checklist
                  </CardTitle>
                  <CardDescription>
                    {loanDiagnostics.findings.length === 0
                      ? "All remaining checks dismissed as not applicable"
                      : `${loanDiagnostics.findings.length} item${loanDiagnostics.findings.length === 1 ? "" : "s"} flagged — missing or incomplete information on this ${loanDiagnostics.kindLabel.toLowerCase()}`}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <FindingsList
                  findings={loanDiagnostics.findings}
                  dismissed={loanDiagnostics.dismissed}
                  onDismiss={canWrite ? (id) => setFindingDismissed(id, true) : undefined}
                  onRestore={canWrite ? (id) => setFindingDismissed(id, false) : undefined}
                />
              </CardContent>
            </Card>
          )}

          {/* ASPE 3856 Fair Value Assessment */}
          <FvDecisionPanel
            loan={loan}
            file={file}
            isLowRate={isLowRate}
            isVeryLowRate={isVeryLowRate}
            rate={rate}
            fvDecisionHistory={fvDecisionHistory}
            confirmFvDecision={confirmFvDecision}
            updateLoan={updateLoan}
            suggestedFvRate={suggestedFvRate}
            fvDiff={fvDiff}
            primeData={primeData}
          />

          {!isOperatingLeaseLoan(loan) ? (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="gap-1 p-1 bg-muted/60 flex-wrap">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="schedule">Schedule</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Full period-by-period amortization schedule</TooltipContent>
                </Tooltip>
                {loan?.rateType === "prime_linked" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="rate-timeline">Rate Timeline</TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Variable rate history and overrides</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="annual">Annual Breakdown</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Yearly totals of payments, principal, and interest</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="chart">Chart</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Visual chart of the declining balance over time</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="summary">Payment Summary</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Totals for payments, principal, and interest over the life of the loan</TooltipContent>
                </Tooltip>
                {assetDepreciation && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="asset">Asset Amortization</TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Depreciation schedule for the underlying asset</TooltipContent>
                  </Tooltip>
                )}
                {isLowRate && fvResult && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="fv">
                        Fair Value
                        {loan.fvDecision === "use_fv" && <Star className="inline h-3 w-3 ml-1 text-amber-500" />}
                      </TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>ASPE 3856 fair value comparison and adjustment</TooltipContent>
                  </Tooltip>
                )}
                {(loan.description || loan.sourceDocumentName) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <TabsTrigger value="notes">Notes &amp; Source</TabsTrigger>
                    </TooltipTrigger>
                    <TooltipContent>Imported summary and the original source document</TooltipContent>
                  </Tooltip>
                )}
              </TabsList>

              <TabsContent value="schedule" className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Full Amortization Schedule</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-[600px] overflow-auto">
                      <Table>
                        <TableHeader className="bg-muted/50 sticky top-0">
                          <TableRow>
                            <TableHead>Period</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead className="text-right">Payment</TableHead>
                            <TableHead className="text-right">Principal</TableHead>
                            <TableHead className="text-right">Interest</TableHead>
                            <TableHead className="text-right">Balance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result && Number(loan.downPayment ?? 0) > 0 && (
                            <TableRow className="bg-muted/50">
                              <TableCell>0</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span>
                                    {format(
                                      (() => {
                                        // Down payment is made one payment period before the first scheduled payment.
                                        const firstPayment = result.schedule[0]?.date ?? parseISO(loan.startDate);
                                        switch (loan.paymentFrequency) {
                                          case "weekly": return subDays(firstPayment, 7);
                                          case "bi-weekly": return subDays(firstPayment, 14);
                                          case "semi-monthly": return subDays(firstPayment, 15);
                                          default: return subMonths(firstPayment, 1);
                                        }
                                      })(),
                                      "MMMM d, yyyy"
                                    )}
                                  </span>
                                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded bg-muted text-muted-foreground px-1.5 py-0.5 whitespace-nowrap">
                                    Down payment
                                  </span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{formatCurrency(Number(loan.downPayment))}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(Number(loan.downPayment))}
                              </TableCell>
                              <TableCell className="text-right">{formatCurrency(0)}</TableCell>
                              <TableCell className="text-right font-semibold">
                                {formatCurrency(Number(loan.principal) - Number(loan.downPayment))}
                              </TableCell>
                            </TableRow>
                          )}
                          {result && result.schedule.map((row, i) => {
                            const isFyeRow = fyeRowMonths.has(row.month);
                            return (
                            <TableRow
                               key={`${row.month}-${row.date.toISOString()}-${row.rowType ?? "scheduled"}-${row.eventId ?? i}`}
                              className={
                                isFyeRow
                                  ? "bg-primary/10 font-semibold border-b-2 border-primary/30"
                                  : i % 2 === 1 ? "bg-muted/20" : ""
                              }
                            >
                              <TableCell>{row.month}</TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span>{format(row.date, "MMMM d, yyyy")}</span>
                                  {row.isGrace && (
                                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded bg-muted text-muted-foreground px-1.5 py-0.5 whitespace-nowrap">
                                      Grace
                                    </span>
                                  )}
                                  {isFyeRow && (
                                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded bg-primary/15 text-primary px-1.5 py-0.5 whitespace-nowrap">
                                      FYE
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-right">{formatCurrency(row.payment)}</TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(row.principal)}
                              </TableCell>
                              <TableCell className="text-right">
                                {formatCurrency(row.interest)}
                              </TableCell>
                              <TableCell className="text-right font-semibold">{formatCurrency(row.balance)}</TableCell>
                            </TableRow>
                            );
                          })}
                          {result && (
                            <TableRow className="bg-muted/50 font-bold border-t-2">
                              <TableCell className="font-bold">Total</TableCell>
                              <TableCell>-</TableCell>
                              <TableCell className="text-right font-bold">
                                {formatCurrency(result.schedule.reduce((s, r) => s + r.payment, 0))}
                              </TableCell>
                              <TableCell className="text-right font-bold">
                                {formatCurrency(result.schedule.reduce((s, r) => s + r.principal, 0))}
                              </TableCell>
                              <TableCell className="text-right font-bold">
                                {formatCurrency(result.schedule.reduce((s, r) => s + r.interest, 0))}
                              </TableCell>
                              <TableCell className="text-right">-</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {loan?.rateType === "prime_linked" && (
                <TabsContent value="rate-timeline" className="space-y-6">
                  {isRateTimelineLoading ? (
                    <div className="flex justify-center p-8 text-muted-foreground">Loading timeline...</div>
                  ) : (
                    <>
                      {/* Unresolved Rate Findings */}
                      {((rateTimeline as any)?.findings || []).filter((f: any) => f.status === "unresolved").length > 0 && (
                        <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
                          <h3 className="flex items-center gap-2 font-semibold text-red-900 mb-2">
                            <AlertTriangle className="h-5 w-5" /> Action Required: Missing Rate Observations
                          </h3>
                          <p className="text-sm text-red-800 mb-3">
                            The application could not automatically retrieve one or more prime rate observations required by the loan agreement's reset rules.
                          </p>
                          <ul className="list-disc pl-5 text-sm text-red-800 space-y-1">
                            {((rateTimeline as any)?.findings || []).filter((f: any) => f.status === "unresolved").map((finding: any) => (
                              <li key={finding.id}>
                                {finding.reason || "Prime observation unavailable"}
                                {finding.contractualEffectiveDate
                                  ? ` (contractual effective date ${String(finding.contractualEffectiveDate).slice(0, 10)})`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                          <div className="mt-4">
                            {canWrite && (
                            <Button variant="outline" className="border-red-300 text-red-900 hover:bg-red-100" onClick={() => setOverrideOpen(true)}>
                              Enter Manual Override
                            </Button>
                            )}
                          </div>
                        </div>
                      )}

                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0">
                          <div>
                            <CardTitle className="font-display">Variable Rate History</CardTitle>
                            <CardDescription>Immutable record of applied benchmark rates and spreads</CardDescription>
                          </div>
                          {canWrite && (
                          <Button variant="outline" size="sm" onClick={() => {
                            setOverrideDate(new Date().toISOString().split("T")[0]);
                            setOverrideRate("");
                            setOverrideReason("");
                            setOverrideUrl("");
                            setOverrideOpen(true);
                          }}>
                            Override Rate
                          </Button>
                          )}
                        </CardHeader>
                        <CardContent>
                          {((rateTimeline as any)?.events || []).length === 0 ? (
                            <div className="text-center py-8 text-muted-foreground border rounded-lg bg-muted/10">
                              No rate reset events recorded yet.
                            </div>
                          ) : (
                            <div className="rounded-md border overflow-hidden">
                              <Table>
                                <TableHeader className="bg-muted/50">
                                  <TableRow>
                                    <TableHead>Effective Date</TableHead>
                                    <TableHead>Benchmark Rate</TableHead>
                                    <TableHead>Spread</TableHead>
                                    <TableHead>Resulting Rate</TableHead>
                                    <TableHead>Source</TableHead>
                                    <TableHead>Origin</TableHead>
                                    <TableHead></TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {((rateTimeline as any)?.events || []).map((ev: any) => (
                                    <TableRow key={ev.id}>
                                      <TableCell className="font-medium whitespace-nowrap">
                                        {format(parseISO(ev.effectiveDate), "MMM d, yyyy")}
                                      </TableCell>
                                      <TableCell>{Number(ev.benchmarkRate).toFixed(2)}%</TableCell>
                                      <TableCell>{Number(ev.spread) >= 0 ? "+" : ""}{Number(ev.spread).toFixed(2)}%</TableCell>
                                      <TableCell className="font-semibold">{Number(ev.resultingRate).toFixed(2)}%</TableCell>
                                      <TableCell>
                                        <div className="flex flex-col">
                                          <span className="text-sm truncate max-w-[200px]" title={ev.source}>{ev.source}</span>
                                          {ev.sourceUrl && (
                                            <a href={ev.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">View source</a>
                                          )}
                                          {ev.publishedDate && (
                                            <span className="text-[10px] text-muted-foreground">Pub: {ev.publishedDate}</span>
                                          )}
                                        </div>
                                      </TableCell>
                                      <TableCell>
                                        {ev.rateOrigin === "override" ? (
                                          <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                            Manual Override
                                          </span>
                                        ) : ev.rateOrigin === "restore" ? (
                                          <span className="inline-flex items-center gap-1 rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                                            Restored
                                          </span>
                                        ) : (
                                          <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                                            Automatic
                                          </span>
                                        )}
                                        {ev.author && <div className="text-[10px] text-muted-foreground mt-0.5">by {ev.author}</div>}
                                      </TableCell>
                                      <TableCell className="text-right">
                                        {ev.rateOrigin === "override" && (
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="text-xs text-muted-foreground hover:text-foreground"
                                            onClick={() => {
                                              setRestoreDate(ev.effectiveDate);
                                              setRestoreOpen(true);
                                            }}
                                          >
                                            Restore Sourced Rate
                                          </Button>
                                        )}
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </>
                  )}
                </TabsContent>
              )}

              <TabsContent value="annual" className="space-y-6">
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <div>
                      <CardTitle className="font-display">Annual Breakdown</CardTitle>
                      <CardDescription>By Fiscal Year</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={downloadAnnualPDF} className="gap-2">
                        <FileText className="h-4 w-4" /> PDF
                      </Button>
                      <Button variant="outline" size="sm" onClick={downloadAnnualExcel} className="gap-2">
                        <Download className="h-4 w-4" /> Excel
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-[400px] overflow-auto">
                      <Table>
                        <TableHeader className="bg-muted/50 sticky top-0">
                          <TableRow>
                            <TableHead>Year</TableHead>
                            <TableHead className="text-right">Opening Balance</TableHead>
                            <TableHead className="text-right">Principal</TableHead>
                            <TableHead className="text-right">Interest</TableHead>
                            <TableHead className="text-right font-bold">Total</TableHead>
                            <TableHead className="text-right">Closing Balance</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {yearlyTotals.map((row, i) => (
                            <TableRow key={row.year} className={i % 2 === 1 ? "bg-muted/20" : ""}>
                              <TableCell className="font-medium">{row.label}</TableCell>
                              <TableCell className="text-right">{formatCurrency(row.opening)}</TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(row.principal)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {formatCurrency(row.interest)}
                              </TableCell>
                              <TableCell className="text-right font-bold">
                                {formatCurrency(row.principal + row.interest)}
                              </TableCell>
                              <TableCell className="text-right font-semibold">{formatCurrency(row.closing)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-bold border-t-2">
                            <TableCell className="font-bold">Total</TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(yearlyTotals.length > 0 ? yearlyTotals[0].opening : 0)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(yearlyTotals.reduce((s, r) => s + r.principal, 0))}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(yearlyTotals.reduce((s, r) => s + r.interest, 0))}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(yearlyTotals.reduce((s, r) => s + r.principal + r.interest, 0))}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(yearlyTotals.length > 0 ? yearlyTotals[yearlyTotals.length - 1].closing : 0)}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="chart" className="space-y-6">
                {chartStats && (
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Original {loan.isCapitalLease ? "Obligation" : "Principal"}
                      </p>
                      <p className="mt-1 text-xl font-display font-semibold">{formatCurrency(chartStats.originalPrincipal)}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Interest (life)</p>
                      <p className="mt-1 text-xl font-display font-semibold text-primary">{formatCurrency(chartStats.totalInterest)}</p>
                    </div>
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {chartStats.endingBalance > 0.01 ? "Scheduled Payments" : "Total Payments"}
                      </p>
                      <p className="mt-1 text-xl font-display font-semibold">{formatCurrency(chartStats.totalPayments)}</p>
                      {chartStats.endingBalance > 0.01 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          + {formatCurrency(chartStats.endingBalance)} residual due at maturity
                        </p>
                      )}
                    </div>
                    <div className="rounded-xl border bg-card p-4 shadow-sm">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Interest % of Payments</p>
                      <p className="mt-1 text-xl font-display font-semibold">{chartStats.interestPct.toFixed(1)}%</p>
                    </div>
                  </div>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Principal vs Interest by Fiscal Year</CardTitle>
                    <CardDescription>
                      How each fiscal year's payments split between principal repayment and interest expense.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {annualChartData.length > 0 ? (
                      <ChartContainer config={{}} className="aspect-auto h-[320px] w-full">
                        <BarChart data={annualChartData} barCategoryGap="20%" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="name" tickLine={false} axisLine={false} />
                          <YAxis tickFormatter={formatCompact} tickLine={false} axisLine={false} width={56} />
                          <RechartsTooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }} content={annualTooltip} />
                          <Legend />
                          <Bar dataKey="principal" name="Principal" stackId="a" fill="hsl(var(--chart-1))" isAnimationActive={false} />
                          <Bar dataKey="interest" name="Interest" stackId="a" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                        </BarChart>
                      </ChartContainer>
                    ) : (
                      <p className="text-sm text-muted-foreground py-8 text-center">No schedule data to chart.</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">
                      {loan.isCapitalLease ? "Obligation Balance" : "Loan Balance"} & Cumulative Interest
                    </CardTitle>
                    <CardDescription>
                      The declining {loan.isCapitalLease ? "lease obligation" : "loan balance"} plotted against interest paid to date over the life of the {loan.isCapitalLease ? "lease" : "loan"}.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {chartData.length > 0 ? (
                      <ChartContainer config={{}} className="aspect-auto h-[360px] w-full">
                        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                          <defs>
                            <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="dateLabel" ticks={balanceTicks} tickFormatter={(v) => String(v).split(" ")[1]} tickLine={false} axisLine={false} />
                          <YAxis yAxisId="left" tickFormatter={formatCompact} tickLine={false} axisLine={false} width={56} />
                          <YAxis yAxisId="right" orientation="right" tickFormatter={formatCompact} tickLine={false} axisLine={false} width={56} />
                          <RechartsTooltip content={balanceTooltip} />
                          <Legend />
                          <Area yAxisId="left" type="monotone" dataKey="balance" name="Outstanding balance" stroke="hsl(var(--chart-1))" fill="url(#balanceFill)" strokeWidth={2.5} isAnimationActive={false} />
                          <Line yAxisId="right" type="monotone" dataKey="totalInterest" name="Cumulative interest" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                        </ComposedChart>
                      </ChartContainer>
                    ) : (
                      <p className="text-sm text-muted-foreground py-8 text-center">No schedule data to chart.</p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="summary" className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="bg-primary text-primary-foreground shadow-xl border-none overflow-hidden">
                    <CardHeader className="pb-2">
                      <CardTitle className="font-display opacity-90 text-sm uppercase tracking-wider">
                        Payment Summary
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6 relative z-10">
                      <div>
                        <div className="text-primary-foreground/80 text-xs font-medium mb-1">
                          {loan.paymentFrequency.charAt(0).toUpperCase() + loan.paymentFrequency.slice(1)} Payment
                        </div>
                        <div className="text-4xl font-display font-bold tracking-tight">
                          {formatCurrency(result?.monthlyPayment ?? 0)}
                        </div>
                      </div>
                      <div className="space-y-3 pt-4 border-t border-primary-foreground/20">
                        <div className="flex justify-between items-center">
                          <span className="text-primary-foreground/80 text-xs">Balloon Payment</span>
                          <span className="font-medium">{formatCurrency(Number(loan.balloonPayment))}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-primary-foreground/80 text-xs">Total Interest</span>
                          <span className="font-medium">{formatCurrency(result?.totalInterest ?? 0)}</span>
                        </div>
                        <div className="flex justify-between items-center font-bold pt-3 border-t border-primary-foreground/10">
                          <span className="text-primary-foreground/90">Total Cost</span>
                          <span className="text-lg">{formatCurrency(result?.totalPayment ?? 0)}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display">{loan.isCapitalLease ? "Lease Details" : "Loan Details"}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Type</span>
                        <span className="font-semibold">{loan.isCapitalLease ? "Capital Lease" : "Loan"}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Principal</span>
                        <span className="font-semibold">{formatCurrency(Number(loan.principal))}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Interest Rate</span>
                        <span className="font-semibold">
                          {loan.rateType === "prime_linked" ? (
                            <div className="flex flex-col items-end">
                              <span>{Number(loan.interestRate).toFixed(2)}% (Prime Linked)</span>
                              <span className="text-xs text-muted-foreground font-normal">
                                {loan.contractualPrimeName || "Benchmark"} {Number(loan.rateSpread) >= 0 ? "+" : ""}{Number(loan.rateSpread).toFixed(2)}%
                              </span>
                            </div>
                          ) : (
                            `${Number(loan.interestRate).toFixed(2)}%`
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Term</span>
                        <span className="font-semibold">{loan.termYears} years</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Amortization</span>
                        <span className="font-semibold">{loan.amortizationYears} years</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Inception Date</span>
                        <span className="font-semibold">{format(parseISO(loan.startDate), "MMMM d, yyyy")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Fiscal Year End</span>
                        <span className="font-semibold">{format(parseISO(loan.fiscalYearEnd), "MMMM d, yyyy")}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Payment Frequency</span>
                        <span className="font-semibold">{loan.paymentFrequency}</span>
                      </div>
                      {loan.assetDescription && (
                        <>
                          <div className="border-t pt-2" />
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Asset</span>
                            <span className="font-semibold">{loan.assetDescription}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Asset Cost</span>
                            <span className="font-semibold">{formatCurrency(Number(loan.assetCost))}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Useful Life</span>
                            <span className="font-semibold">{loan.assetUsefulLife} years</span>
                          </div>
                        </>
                      )}
                      {loan.rolledFromId && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Rolled From</span>
                          <span className="font-semibold">{loan.rolledFromId}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {loan.capitalLeaseRationale && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="font-display">ASPE Assessment</CardTitle>
                        <CardDescription>Capital lease classification rationale</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <p className="text-sm">{loan.capitalLeaseRationale}</p>
                        <div className="space-y-1 pt-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Transfer of Ownership</span>
                            <span>{loan.transferOfOwnership ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Bargain Purchase Option</span>
                            <span>{loan.bargainPurchaseOption ? "Yes" : "No"}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Lease Term % of Life</span>
                            <span>{loan.leaseTermPct}%</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">PV % of Fair Value</span>
                            <span>{loan.pvPctFairValue}%</span>
                          </div>
                          {loan.fairValue && (
                            <div className="flex justify-between text-sm">
                              <span className="text-muted-foreground">Fair Value</span>
                              <span>{formatCurrency(Number(loan.fairValue))}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Specialized Asset</span>
                            <span>{loan.specializedAsset ? "Yes" : "No"}</span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </TabsContent>

              {assetDepreciation && (
                <TabsContent value="asset" className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display">Asset Amortization Schedule</CardTitle>
                      <CardDescription>
                        {assetDepreciation.description} — {assetDepreciation.methodLabel}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="px-6 pb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">Cost</div>
                          <div className="font-semibold">{formatCurrency(assetDepreciation.cost)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Salvage Value</div>
                          <div className="font-semibold">{formatCurrency(assetDepreciation.salvage)}</div>
                        </div>
                        {assetDepreciation.landCost > 0 && (
                          <div>
                            <div className="text-muted-foreground">Land (not amortized)</div>
                            <div className="font-semibold">{formatCurrency(assetDepreciation.landCost)}</div>
                          </div>
                        )}
                        <div>
                          <div className="text-muted-foreground">NBV at FY{assetDepreciation.reportFY} Year End</div>
                          <div className="font-semibold">
                            {formatCurrency(
                              (assetDepreciation.rows.find((r) => r.fiscalYear === assetDepreciation.reportFY)?.closingNbv ??
                                (assetDepreciation.reportFY < assetDepreciation.rows[0].fiscalYear
                                  ? assetDepreciation.cost
                                  : assetDepreciation.rows[assetDepreciation.rows.length - 1].closingNbv)) +
                                assetDepreciation.landCost,
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="max-h-[600px] overflow-auto">
                        <Table>
                          <TableHeader className="bg-muted/50 sticky top-0">
                            <TableRow>
                              <TableHead>Fiscal Year</TableHead>
                              <TableHead className="text-right">Opening NBV</TableHead>
                              <TableHead className="text-right">Amortization</TableHead>
                              <TableHead className="text-right">Accumulated</TableHead>
                              <TableHead className="text-right">Closing NBV</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {assetDepreciation.rows.map((row, i) => {
                              const isReportYear = row.fiscalYear === assetDepreciation.reportFY;
                              return (
                                <TableRow
                                  key={row.fiscalYear}
                                  className={
                                    isReportYear
                                      ? "bg-primary/10 font-semibold"
                                      : i % 2 === 1
                                        ? "bg-muted/20"
                                        : ""
                                  }
                                >
                                  <TableCell>
                                    {row.fiscalYear}
                                    {isReportYear && (
                                      <span className="ml-2 text-xs text-muted-foreground font-normal">(reporting year)</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">{formatCurrency(row.openingNbv)}</TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(row.depreciation)}
                                  </TableCell>
                                  <TableCell className="text-right">{formatCurrency(row.accumulated)}</TableCell>
                                  <TableCell className="text-right font-semibold">{formatCurrency(row.closingNbv)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      {assetDepreciation.landCost > 0 && (
                        <p className="px-6 py-3 text-xs text-muted-foreground border-t">
                          Land of {formatCurrency(assetDepreciation.landCost)} is carried at cost and not amortized; it is
                          excluded from the table above but included in the disclosed combined net book value.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {/* ── Fair Value Tab ───────────────────────────────────────────── */}
              {isLowRate && fvResult && (
                <TabsContent value="fv" className="space-y-6">
                  {/* Dual amortization toggle */}
                  <Tabs value={fvTab} onValueChange={setFvTab}>
                    <TabsList className="gap-1 p-1 bg-muted/60">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <TabsTrigger value="actual">
                            Actual ({rate.toFixed(2)}%)
                            {loan.fvDecision === "use_fv" ? null : <Star className="inline h-3 w-3 ml-1 text-amber-500" />}
                          </TabsTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Schedule at the contractual rate</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <TabsTrigger value="fv">
                            Fair Value ({suggestedFvRate.toFixed(2)}%)
                            {loan.fvDecision === "use_fv" ? <Star className="inline h-3 w-3 ml-1 text-amber-500" /> : null}
                          </TabsTrigger>
                        </TooltipTrigger>
                        <TooltipContent>Schedule at the imputed fair value rate</TooltipContent>
                      </Tooltip>
                    </TabsList>
                    <TabsContent value="actual" className="space-y-4">
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                          <CardTitle className="font-display">Actual Rate Schedule</CardTitle>
                          {loan.fvDecision !== "use_fv" && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded">
                              <Star className="h-3 w-3" /> Active
                            </span>
                          )}
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="max-h-[400px] overflow-auto">
                            <Table>
                              <TableHeader className="bg-muted/50 sticky top-0">
                                <TableRow>
                                  <TableHead>Period</TableHead>
                                  <TableHead>Date</TableHead>
                                  <TableHead className="text-right">Payment</TableHead>
                                  <TableHead className="text-right">Principal</TableHead>
                                  <TableHead className="text-right">Interest</TableHead>
                                  <TableHead className="text-right">Balance</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {contractualResult?.schedule.slice(0, 60).map((row, i) => (
                                   <TableRow
                                     key={`${row.month}-${row.date.toISOString()}-${row.rowType ?? "scheduled"}-${row.eventId ?? i}`}
                                     className={i % 2 === 1 ? "bg-muted/20" : ""}
                                   >
                                    <TableCell>{row.month}</TableCell>
                                    <TableCell>{format(row.date, "MMMM d, yyyy")}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(row.payment)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(row.principal)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(row.interest)}</TableCell>
                                    <TableCell className="text-right font-semibold">{formatCurrency(row.balance)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                    <TabsContent value="fv" className="space-y-4">
                      <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                          <CardTitle className="font-display">Fair Value Rate Schedule</CardTitle>
                          {loan.fvDecision === "use_fv" && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded">
                              <Star className="h-3 w-3" /> Active
                            </span>
                          )}
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="max-h-[400px] overflow-auto">
                            <Table>
                              <TableHeader className="bg-muted/50 sticky top-0">
                                <TableRow>
                                  <TableHead>Period</TableHead>
                                  <TableHead>Date</TableHead>
                                  <TableHead className="text-right">Payment</TableHead>
                                  <TableHead className="text-right">Principal</TableHead>
                                  <TableHead className="text-right">Interest</TableHead>
                                  <TableHead className="text-right">Balance</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {fvResult?.schedule.slice(0, 60).map((row, i) => (
                                   <TableRow
                                     key={`${row.month}-${row.date.toISOString()}-${row.rowType ?? "scheduled"}-${row.eventId ?? i}`}
                                     className={i % 2 === 1 ? "bg-muted/20" : ""}
                                   >
                                    <TableCell>{row.month}</TableCell>
                                    <TableCell>{format(row.date, "MMMM d, yyyy")}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(row.payment)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(row.principal)}</TableCell>
                                    <TableCell className="text-right">{formatCurrency(row.interest)}</TableCell>
                                    <TableCell className="text-right font-semibold">{formatCurrency(row.balance)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </CardContent>
                      </Card>
                    </TabsContent>
                  </Tabs>

                  {/* Annual breakdown comparison */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display">Annual Breakdown Comparison</CardTitle>
                      <CardDescription>
                        Actual ({rate.toFixed(2)}%) vs Fair Value ({suggestedFvRate.toFixed(2)}%)
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="max-h-[400px] overflow-auto">
                        <Table>
                          <TableHeader className="bg-muted/50 sticky top-0">
                            <TableRow>
                              <TableHead>Year</TableHead>
                              <TableHead className="text-right">Actual Principal</TableHead>
                              <TableHead className="text-right">FV Principal</TableHead>
                              <TableHead className="text-right">Principal Diff</TableHead>
                              <TableHead className="text-right">Actual Interest</TableHead>
                              <TableHead className="text-right">FV Interest</TableHead>
                              <TableHead className="text-right">Interest Diff</TableHead>
                              <TableHead className="text-right">Adjusting Entry</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {yearlyTotalsActual.map((row, i) => {
                              const fv = yearlyTotalsFv.find((r) => r.year === row.year);
                              const prinDiff = fv ? Number((fv.principal - row.principal).toFixed(2)) : 0;
                              const intDiff = fv ? Number((fv.interest - row.interest).toFixed(2)) : 0;
                              const hasAdjEntry = !!fvAccounting?.annualEntries.some(e => (e.evidence as any).fiscalYear === row.year) || !!fvAccounting?.cumulativeSupport.some(e => (e.evidence as any).fiscalYear === row.year);
                              const diffCell = (v: number) => (
                                <span className={v > 0 ? "text-amber-600" : ""}>
                                  {v !== 0 ? (v > 0 ? "+" : "") + formatCurrency(v) : "-"}
                                </span>
                              );
                              return (
                                <TableRow key={row.year} className={i % 2 === 1 ? "bg-muted/20" : ""}>
                                  <TableCell className="font-medium">{row.label}</TableCell>
                                  <TableCell className="text-right">{formatCurrency(row.principal)}</TableCell>
                                  <TableCell className="text-right">{fv ? formatCurrency(fv.principal) : "-"}</TableCell>
                                  <TableCell className="text-right font-semibold">{diffCell(prinDiff)}</TableCell>
                                  <TableCell className="text-right">{formatCurrency(row.interest)}</TableCell>
                                  <TableCell className="text-right">{fv ? formatCurrency(fv.interest) : "-"}</TableCell>
                                  <TableCell className="text-right font-semibold">{diffCell(intDiff)}</TableCell>
                                  <TableCell className="text-right">
                                    {hasAdjEntry ? (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-7 gap-1.5"
                                        onClick={() => setAdjEntryYear(row.year)}
                                      >
                                        <FileText className="h-3.5 w-3.5" />
                                        View
                                      </Button>
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>

                  <p className="text-xs text-muted-foreground px-1">
                    Use the <span className="font-medium">Adjusting Entry</span> button on any
                    year above to view the cumulative unrecorded fair-value adjustment as at
                    that fiscal year end, for audit/review working-paper documentation.
                  </p>
                </TabsContent>
              )}

              {/* ── Notes & Source Tab ───────────────────────────────────────── */}
              {(loan.description || loan.sourceDocumentName) && (
                <TabsContent value="notes" className="space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="font-display">Notes &amp; Source</CardTitle>
                      <CardDescription>Summary and source document for this {loan.isCapitalLease ? "lease" : "loan"}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {loan.description && (
                        <p className="text-sm leading-relaxed">{loan.description}</p>
                      )}
                      {loan.sourceDocumentName && (
                        <Button asChild variant="outline" size="sm" className="gap-2">
                          <a
                            href={`${import.meta.env.BASE_URL}api/loans/${loanId}/source-document`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Paperclip className="h-4 w-4" />
                            <span className="truncate">{loan.sourceDocumentName}</span>
                          </a>
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}
            </Tabs>
          ) : (
            /* Operating Lease View */
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-amber-50 border-amber-200">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 font-display">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                      Operating Lease
                    </CardTitle>
                    <CardDescription>ASPE 3065 — No balance sheet impact</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      {loan.capitalLeaseRationale || "This lease does not meet any capital lease criteria under ASPE Section 3065."}
                    </p>
                    <div className="space-y-1 pt-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Transfer of Ownership</span>
                        <span>{loan.transferOfOwnership ? "Yes" : "No"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Bargain Purchase Option</span>
                        <span>{loan.bargainPurchaseOption ? "Yes" : "No"}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Lease Term % of Life</span>
                        <span>{loan.leaseTermPct}%</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">PV % of Fair Value</span>
                        <span>{loan.pvPctFairValue}%</span>
                      </div>
                      {loan.fairValue && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Fair Value</span>
                          <span>{formatCurrency(Number(loan.fairValue))}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Specialized Asset</span>
                        <span>{loan.specializedAsset ? "Yes" : "No"}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Lease Details</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Monthly Payment</span>
                      <span className="font-semibold">{formatCurrency(Number(loan.monthlyPayment ?? 0))}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Term</span>
                      <span className="font-semibold">{loan.termMonths} months ({loan.termYears} years)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Inception Date</span>
                      <span className="font-semibold">{format(parseISO(loan.startDate), "MMMM d, yyyy")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fiscal Year End</span>
                      <span className="font-semibold">{format(parseISO(loan.fiscalYearEnd), "MMMM d, yyyy")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Commitment</span>
                      <span className="font-semibold">{formatCurrency(Number(loan.principal))}</span>
                    </div>
                    {Number(loan.camMonthly ?? 0) > 0 && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">CAM / Operating Costs</span>
                          <span className="font-semibold">{formatCurrency(Number(loan.camMonthly))}/month</span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          CAM and operating costs are executory costs — they are expensed as billed and excluded from
                          the minimum lease payment disclosure and the straight-line rent calculation (ASPE 3065).
                        </p>
                      </>
                    )}
                    {loan.assetDescription && (
                      <>
                        <div className="border-t pt-2" />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Asset</span>
                          <span className="font-semibold">{loan.assetDescription}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Asset Cost</span>
                          <span className="font-semibold">{formatCurrency(Number(loan.assetCost))}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Useful Life</span>
                          <span className="font-semibold">{loan.assetUsefulLife} years</span>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Notes & Source */}
              {(loan.description || loan.sourceDocumentName) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Notes &amp; Source</CardTitle>
                    <CardDescription>Summary and source document for this lease</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {loan.description && (
                      <p className="text-sm leading-relaxed">{loan.description}</p>
                    )}
                    {loan.sourceDocumentName && (
                      <Button asChild variant="outline" size="sm" className="gap-2">
                        <a
                          href={`${import.meta.env.BASE_URL}api/loans/${loanId}/source-document`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Paperclip className="h-4 w-4" />
                          <span className="truncate">{loan.sourceDocumentName}</span>
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Minimum Lease Payments Schedule */}
              <Card>
                <CardHeader>
                  <CardTitle className="font-display">Minimum Lease Payments Schedule</CardTitle>
                  <CardDescription>Operating lease commitments by fiscal year</CardDescription>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 font-medium">Period</th>
                        <th className="text-right p-2 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        // Build the actual cash schedule (respects start date,
                        // free rent, and escalations) and group it by fiscal year.
                        const sl = calculateStraightLineLease({
                          baseMonthlyRent: Number(loan.monthlyPayment ?? 0),
                          termMonths: loan.termMonths ?? 0,
                          freeRentMonths: loan.freeRentMonths ?? 0,
                          escalationRate: Number(loan.rentEscalationRate ?? 0),
                          rentSteps: (loan.rentSteps as Array<{ fromYear: number; toYear: number; monthlyRent: number }> | undefined) ?? [],
                          tenantImprovementAllowance: Number(loan.tenantImprovementAllowance ?? 0),
                          otherInducements: Number(loan.otherInducements ?? 0),
                          startDate: loan.startDate,
                          fiscalYearEnd: loan.fiscalYearEnd,
                        });
                        if (!sl) {
                          return (
                            <tr className="border-t">
                              <td className="p-2 text-muted-foreground" colSpan={2}>
                                Schedule unavailable — missing monthly payment or lease term.
                              </td>
                            </tr>
                          );
                        }
                        const cashByFy = new Map<number, number>();
                        for (const p of sl.schedule) {
                          cashByFy.set(p.fiscalYear, (cashByFy.get(p.fiscalYear) ?? 0) + p.actualPayment);
                        }
                        const entries = Array.from(cashByFy.entries()).sort((a, b) => a[0] - b[0]);
                        const years: Array<{ label: string; amount: number }> = [];
                        let thereafter = 0;
                        for (let i = 0; i < entries.length; i++) {
                          if (i < 5) {
                            years.push({ label: `FY ${entries[i][0]}`, amount: entries[i][1] });
                          } else {
                            thereafter += entries[i][1];
                          }
                        }
                        const totalPayments = sl.totalLeasePayments;
                        return (
                          <>
                            {years.map((y) => (
                              <tr key={y.label} className="border-t">
                                <td className="p-2">{y.label}</td>
                                <td className="p-2 text-right">{formatCurrency(y.amount)}</td>
                              </tr>
                            ))}
                            {thereafter > 0 && (
                              <tr className="border-t">
                                <td className="p-2">Thereafter</td>
                                <td className="p-2 text-right">{formatCurrency(thereafter)}</td>
                              </tr>
                            )}
                            <tr className="border-t font-semibold bg-muted/30">
                              <td className="p-2">Total Minimum Lease Payments</td>
                              <td className="p-2 text-right">{formatCurrency(totalPayments)}</td>
                            </tr>
                          </>
                        );
                      })()}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Straight-Line Lease Adjustments — Operating Leases Only */}
          {(() => {
            const isOperatingLease = loan && isOperatingLeaseLoan(loan);
            if (!isOperatingLease) return null;
            const sl = calculateStraightLineLease({
              baseMonthlyRent: Number(loan.monthlyPayment ?? 0),
              termMonths: loan.termMonths ?? 0,
              freeRentMonths: loan.freeRentMonths ?? 0,
              escalationRate: Number(loan.rentEscalationRate ?? 0),
              rentSteps: (loan.rentSteps as Array<{ fromYear: number; toYear: number; monthlyRent: number }> | undefined) ?? [],
              tenantImprovementAllowance: Number(loan.tenantImprovementAllowance ?? 0),
              otherInducements: Number(loan.otherInducements ?? 0),
              startDate: loan.startDate,
              fiscalYearEnd: loan.fiscalYearEnd,
            });
            if (!sl) return null;
            const yearly = buildYearlyStraightLine(sl.schedule);
            return (
              <div className="space-y-6">
                {/* Alert banner for office/property leases */}
                {(loan.isOfficeProperty || (!loan.isOfficeProperty && (sl.totalInducements > 0 || sl.schedule.some((p) => p.actualPayment !== p.straightLineExpense)))) && (
                  <div className="rounded-lg border bg-muted/50 p-4 flex items-start gap-3">
                    <div className="mt-0.5">
                      <ShieldCheck className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">
                        {loan.isOfficeProperty ? "Office / Property Lease — Straight-Line Adjustment Required" : "Straight-Line Adjustment May Be Required"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Under ASPE, lease expense must be recognized on a straight-line basis over the lease term. Any inducements (free rent, TI allowances, etc.) are amortized into the straight-line expense.
                      </p>
                    </div>
                  </div>
                )}

                <Card>
                  <CardHeader>
                    <CardTitle className="font-display">Straight-Line Lease Expense</CardTitle>
                    <CardDescription>
                      Total consideration {formatCurrency(sl.totalConsideration)} amortized over {loan.termMonths} months
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="rounded-lg border p-3 bg-muted/30">
                        <p className="text-xs text-muted-foreground">Total Lease Payments</p>
                        <p className="text-lg font-semibold">{formatCurrency(sl.totalLeasePayments)}</p>
                      </div>
                      <div className="rounded-lg border p-3 bg-muted/30">
                        <p className="text-xs text-muted-foreground">Total Inducements</p>
                        <p className="text-lg font-semibold">{formatCurrency(sl.totalInducements)}</p>
                      </div>
                      <div className="rounded-lg border p-3 bg-primary/5 border-primary/20">
                        <p className="text-xs text-primary font-medium">Monthly Straight-Line</p>
                        <p className="text-lg font-semibold text-primary">{formatCurrency(sl.monthlyStraightLineExpense)}</p>
                      </div>
                      <div className={`rounded-lg border p-3 ${sl.deferredRentAtYearEnd >= 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
                        <p className={`text-xs font-medium ${sl.deferredRentAtYearEnd >= 0 ? "text-red-700" : "text-green-700"}`}>
                          Deferred Rent at FYE
                        </p>
                        <p className={`text-lg font-semibold ${sl.deferredRentAtYearEnd >= 0 ? "text-red-700" : "text-green-700"}`}>
                          {formatCurrency(Math.abs(sl.deferredRentAtYearEnd))} {sl.deferredRentAtYearEnd >= 0 ? "Liability" : "Asset"}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/40">
                            <th className="text-left p-2 font-medium">Fiscal Year</th>
                            <th className="text-right p-2 font-medium">Actual Payments</th>
                            <th className="text-right p-2 font-medium">Straight-Line</th>
                            <th className="text-right p-2 font-medium">Difference</th>
                            <th className="text-right p-2 font-medium">Deferred Rent</th>
                          </tr>
                        </thead>
                        <tbody>
                          {yearly.map((row) => (
                            <tr key={row.fiscalYear} className="border-t">
                              <td className="p-2">{row.fiscalYear}</td>
                              <td className="p-2 text-right">{formatCurrency(row.actual)}</td>
                              <td className="p-2 text-right">{formatCurrency(row.straightLine)}</td>
                              <td className={`p-2 text-right ${row.difference > 0 ? "text-red-600" : row.difference < 0 ? "text-green-600" : ""}`}>
                                {row.difference > 0 ? "+" : ""}{formatCurrency(row.difference)}
                              </td>
                              <td className={`p-2 text-right font-medium ${row.deferredRent > 0 ? "text-red-700" : row.deferredRent < 0 ? "text-green-700" : ""}`}>
                                {row.deferredRent > 0 ? "Liability " : row.deferredRent < 0 ? "Asset " : ""}
                                {formatCurrency(Math.abs(row.deferredRent))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Originating Entries */}
                    {(Number(loan.tenantImprovementAllowance ?? 0) > 0 || Number(loan.otherInducements ?? 0) > 0) && (
                      <div className="space-y-3">
                        <h4 className="font-semibold text-sm">Originating Journal Entries — Lease Inducements</h4>
                        {Number(loan.tenantImprovementAllowance ?? 0) > 0 && (
                          <div className="rounded-lg border overflow-hidden text-sm">
                            <div className="bg-muted/40 p-2 text-xs font-medium text-muted-foreground">
                              At lease inception — Tenant Improvement Allowance
                            </div>
                            <table className="w-full">
                              <tbody>
                                <tr className="border-t">
                                  <td className="p-2">Dr. Cash / Leasehold Improvements</td>
                                  <td className="p-2 text-right">{formatCurrency(Number(loan.tenantImprovementAllowance ?? 0))}</td>
                                </tr>
                                <tr className="border-t">
                                  <td className="p-2 pl-6">Cr. Lease Incentive Liability</td>
                                  <td className="p-2 text-right">{formatCurrency(Number(loan.tenantImprovementAllowance ?? 0))}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                        {Number(loan.otherInducements ?? 0) > 0 && (
                          <div className="rounded-lg border overflow-hidden text-sm">
                            <div className="bg-muted/40 p-2 text-xs font-medium text-muted-foreground">
                              At lease inception — Other Inducements
                            </div>
                            <table className="w-full">
                              <tbody>
                                <tr className="border-t">
                                  <td className="p-2">Dr. Cash</td>
                                  <td className="p-2 text-right">{formatCurrency(Number(loan.otherInducements ?? 0))}</td>
                                </tr>
                                <tr className="border-t">
                                  <td className="p-2 pl-6">Cr. Lease Incentive Liability</td>
                                  <td className="p-2 text-right">{formatCurrency(Number(loan.otherInducements ?? 0))}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Recurring Monthly Entries */}
                    <div className="space-y-3">
                      <h4 className="font-semibold text-sm">Recurring Monthly Journal Entry</h4>
                      {(() => {
                        const cashVaries = (loan.freeRentMonths ?? 0) > 0 || Number(loan.rentEscalationRate ?? 0) > 0 || ((loan.rentSteps as unknown[] | undefined)?.length ?? 0) > 0;
                        return (
                      <div className="rounded-lg border overflow-hidden text-sm">
                        <div className="bg-muted/40 p-2 text-xs font-medium text-muted-foreground">
                          {cashVaries
                            ? "Straight-line expense is the same every month; the cash amount varies by month (free rent / escalations) — use the actual payment for each month from the schedule above. Shown below using the base monthly rent."
                            : "Same every month over the lease term"}
                        </div>
                        <table className="w-full">
                          <tbody>
                            <tr className="border-t">
                              <td className="p-2">Dr. Rent Expense</td>
                              <td className="p-2 text-right">{formatCurrency(sl.monthlyStraightLineExpense)}</td>
                            </tr>
                            <tr className="border-t">
                              <td className="p-2 pl-6">Cr. Cash / Accounts Payable{cashVaries ? " (base rent — varies by month)" : ""}</td>
                              <td className="p-2 text-right">{formatCurrency(Number(loan.monthlyPayment ?? 0))}</td>
                            </tr>
                            <tr className="border-t">
                              <td className="p-2 pl-6">
                                {sl.monthlyStraightLineExpense > Number(loan.monthlyPayment ?? 0) ? "Cr. Deferred Rent" : sl.monthlyStraightLineExpense < Number(loan.monthlyPayment ?? 0) ? "Dr. Deferred Rent" : "Deferred Rent (no difference)"}
                              </td>
                              <td className="p-2 text-right">{formatCurrency(Math.abs(sl.monthlyStraightLineExpense - Number(loan.monthlyPayment ?? 0)))}</td>
                            </tr>
                          </tbody>
                        </table>
                        <div className="bg-muted/50 border-t p-2 text-xs text-muted-foreground">
                          <p>
                            <strong>Note:</strong> The deferred rent balance flips from asset to liability over the lease term when cash exceeds the straight-line expense. Review the year-end balance in the table above.
                          </p>
                        </div>
                      </div>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })()}
        </main>
      </div>

      <Dialog open={adjEntryYear != null} onOpenChange={(open) => !open && setAdjEntryYear(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {(() => {
            if (adjEntryYear == null || !fvAccounting) return null;

            const annualEntry = fvAccounting.annualEntries.find(e => (e.evidence as any).fiscalYear === adjEntryYear);
            const cumulative = fvAccounting.cumulativeSupport.find(e => (e.evidence as any).fiscalYear === adjEntryYear);

            // Only show day-one if it's the first year of the loan
            const isFirstYear = fvAccounting.annualEntries.length > 0 && (fvAccounting.annualEntries[0].evidence as any).fiscalYear === adjEntryYear;
            const dayOneEntry = isFirstYear ? fvAccounting.dayOne : null;

            if (!annualEntry && !cumulative) return null;

            return (
              <>
                <DialogHeader>
                  <DialogTitle className="font-display flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Fair Value Accounting Entries — Year {adjEntryYear}
                  </DialogTitle>
                  <DialogDescription>
                    Distinct day-one and annual effective-interest entries for the year.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-6">
                  {dayOneEntry && (
                    <div className="rounded-lg border overflow-hidden text-sm">
                      <div className="bg-muted/40 p-2 text-xs font-medium text-muted-foreground border-b">
                        {dayOneEntry.label}
                      </div>
                      <table className="w-full">
                        <thead>
                          <tr className="border-b bg-muted/20">
                            <th className="text-left p-2 font-medium">Account</th>
                            <th className="text-right p-2 font-medium">Debit</th>
                            <th className="text-right p-2 font-medium">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dayOneEntry.lines.map((line: any, idx: number) => (
                            <tr key={idx} className="border-t align-top">
                              <td className="p-2 font-medium">{line.account}</td>
                              <td className="p-2 text-right">{line.debit ? formatCurrency(line.debit) : ""}</td>
                              <td className="p-2 text-right">{line.credit ? formatCurrency(line.credit) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {annualEntry && (
                    <div className="rounded-lg border overflow-hidden text-sm">
                      <div className="bg-muted/40 p-2 text-xs font-medium text-muted-foreground border-b">
                        {annualEntry.label}
                      </div>
                      <table className="w-full">
                        <thead>
                          <tr className="border-b bg-muted/20">
                            <th className="text-left p-2 font-medium">Account</th>
                            <th className="text-right p-2 font-medium">Debit</th>
                            <th className="text-right p-2 font-medium">Credit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {annualEntry.lines.map((line: any, idx: number) => (
                            <tr key={idx} className="border-t align-top">
                              <td className="p-2 font-medium">{line.account}</td>
                              <td className="p-2 text-right">{line.debit ? formatCurrency(line.debit) : ""}</td>
                              <td className="p-2 text-right">{line.credit ? formatCurrency(line.credit) : ""}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {cumulative && (
                    <div className="rounded-lg border p-4 bg-muted/20 space-y-3">
                      <h4 className="text-sm font-semibold">Supporting Cumulative Reconciliation</h4>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">Day-one FV difference</div>
                          <div className="font-semibold">{formatCurrency(cumulative.dayOneDifference)}</div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">Accreted to date</div>
                          <div className="font-semibold">{formatCurrency(cumulative.cumulativeAccretion)}</div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">Remaining discount</div>
                          <div className="font-semibold">{formatCurrency(cumulative.remainingDiscount)}</div>
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-relaxed mt-2">
                        The cumulative unrecorded adjustment as at the fiscal year end. Because the client keeps the loan on the books at contractual amounts and the day-one discount unwinds over time through extra interest, the required adjustment is the day-one discount less the discount already accreted.
                      </p>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setAdjEntryYear(null)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              {editMode === "capital_lease" ? "Edit Capital Lease" : editMode === "operating_lease" ? "Edit Operating Lease" : "Edit Loan"}
            </DialogTitle>
            <DialogDescription>
              Update loan parameters.
            </DialogDescription>
          </DialogHeader>
          <LoanFormFields form={editForm} setForm={setEditForm} mode={editMode} />
          <ModificationAssessment
            key={`${loanId}-${modification.predecessorAgreementId ?? "none"}`}
            agreements={[...(fileLoans ?? []), ...(linkedPredecessor ? [linkedPredecessor] : [])].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)}
            currentAgreementId={loanId}
            successor={editForm}
            mode={editMode}
            initialPredecessorId={modification.predecessorAgreementId}
            initialEffectiveDate={modification.modificationEffectiveDate}
            initialAssessment={modification.modificationAssessment}
            onChange={setModification}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const validationError = validateLoanForm(editForm, editMode);
                if (validationError) {
                  toast({ title: "Missing information", description: validationError, variant: "destructive" });
                  return;
                }
                {
                  updateLoan.mutate({
                    id: loanId,
                    data: {
                      name: editForm.name,
                      description: editForm.description || undefined,
                      counterparty: editForm.counterparty,
                      isCapitalLease: editForm.isCapitalLease,
                      principal: editForm.principal,
                      downPayment: editForm.downPayment,
                      interestRate: Number(editForm.interestRate),
                      rateType: editForm.rateType,
                      rateBenchmark: editForm.rateType === "prime_linked"
                        ? editForm.rateBenchmark === "boc_v80691311" ? "boc_v80691311" : undefined
                        : null,
                      contractualPrimeName: editForm.contractualPrimeName,
                      benchmarkEquivalentToContractualPrime: editForm.benchmarkEquivalentToContractualPrime,
                      rateSpread: editForm.rateSpread,
                      rateResetFrequency: editForm.rateResetFrequency,
                      rateEffectiveConvention: editForm.rateEffectiveConvention,
                      ratePaymentTreatment: editForm.ratePaymentTreatment,
                      initialFvRateAssumption: editForm.initialFvRateAssumption,
                      amortizationYears: editForm.amortizationYears,
                      termYears: editForm.termYears,
                      startDate: editForm.startDate,
                      paymentFrequency: editForm.paymentFrequency,
                      paymentTiming: editForm.paymentTiming,
                      graceTermMode: editForm.graceTermMode,
                      firstPaymentDate: editForm.firstPaymentDate || null,
                      semiMonthlyFirstDueDay: editForm.semiMonthlyFirstDueDay ?? null,
                      semiMonthlySecondDueDay: editForm.semiMonthlySecondDueDay ?? null,
                      ioMonths: editForm.ioMonths,
                      graceMonths: editForm.graceMonths,
                      graceInterestTreatment: editForm.graceInterestTreatment,
                      balloonPayment: editForm.balloonPayment,
                      transferOfOwnership: editForm.transferOfOwnership,
                      bargainPurchaseOption: editForm.bargainPurchaseOption,
                      leaseTermPct: editForm.leaseTermPct,
                      pvPctFairValue: editForm.pvPctFairValue,
                      fairValue: editForm.fairValue || null,
                      specializedAsset: editForm.specializedAsset,
                      assetDescription: editForm.assetDescription || null,
                      assetCost: editForm.assetCost || null,
                      assetUsefulLife: editForm.assetUsefulLife || null,
                      capitalLeaseRationale: editForm.capitalLeaseRationale || null,
                      monthlyPayment: editForm.monthlyPayment,
                      paymentOverride: editForm.paymentOverride ?? null,
                      termMonths: editForm.termMonths,
                      isOfficeProperty: editForm.isOfficeProperty,
                      freeRentMonths: editForm.freeRentMonths,
                      rentEscalationRate: editForm.rentEscalationRate,
                      rentSteps: editForm.rentSteps.length > 0 ? editForm.rentSteps : null,
                      tenantImprovementAllowance: editForm.tenantImprovementAllowance,
                      otherInducements: editForm.otherInducements,
                      inducementReceivedInCash: editForm.inducementReceivedInCash,
                      covenantViolation: editForm.covenantViolation,
                                                                                        securityClauses: editForm.securityClauses,
                      collateralType: editForm.collateralType || null,
                      collateralDescription: editForm.collateralDescription || null,
                      collateralDepreciableCost: editForm.collateralDepreciableCost || null,
                      collateralLandCost: editForm.collateralLandCost || null,
                      collateralInServiceDate: editForm.collateralInServiceDate || null,
                      collateralMethod: editForm.collateralMethod || null,
                      collateralUsefulLifeYears: editForm.collateralUsefulLifeYears || null,
                      collateralDecliningRate: editForm.collateralDecliningRate || null,
                      collateralSalvageValue: editForm.collateralSalvageValue || null,
                      predecessorAgreementId: modification.predecessorAgreementId,
                      modificationEffectiveDate: modification.modificationEffectiveDate,
                      modificationAssessment: modification.modificationAssessment,
                    },
                  });
                }
              }}
              disabled={validateLoanForm(editForm, editMode) !== null || !modification.valid || updateLoan.isPending}
            >
              {updateLoan.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reevaluate Lease Wizard */}
      {(() => {
        if (!loan) return null;
        const isLease = loan.isCapitalLease || (isOperatingLeaseLoan(loan));
        if (!isLease) return null;
        const initialAnswers: AssessmentAnswers = {
          transferOfOwnership: loan.transferOfOwnership,
          bargainPurchaseOption: loan.bargainPurchaseOption,
          leaseTermPct: Number(loan.leaseTermPct),
          pvPctFairValue: Number(loan.pvPctFairValue),
          fairValue: Number(loan.fairValue ?? 0),
          specializedAsset: loan.specializedAsset,
          assetType: parseAssetType(loan.assetDescription ?? ""),
          economicLife: loan.assetUsefulLife ?? 0,
          termMonths: loan.termMonths ?? 0,
          monthlyPayment: loan.monthlyPayment != null ? Number(loan.monthlyPayment) : 0,
          downPayment: Number(loan.downPayment ?? 0),
          interestRate: Number(loan.interestRate),
          paymentAtBeginning: false,
          paymentIncludesTax: false,
          taxType: "none",
          taxRate: 0,
          buyoutForImplicitRate: 0,
        };
        return (
          <CapitalLeaseAssessment
            readOnly={!canWrite}
            open={reevaluateOpen}
            onOpenChange={setReevaluateOpen}
            onConfirm={(result) => {
              // Operating-lease total commitment must respect rent steps and
              // free-rent months, not just first-year rent × term.
              const slPreview = !result.isCapitalLease
                ? calculateStraightLineLease({
                    baseMonthlyRent: result.answers.monthlyPayment,
                    termMonths: result.answers.termMonths,
                    freeRentMonths: result.straightLine?.freeRentMonths ?? 0,
                    escalationRate: result.straightLine?.rentEscalationRate ?? 0,
                    rentSteps: result.straightLine?.rentSteps,
                    startDate: loan.startDate,
                    fiscalYearEnd: loan.fiscalYearEnd,
                  })
                : null;
              updateLoan.mutate({
                id: loanId,
                data: {
                  isCapitalLease: result.isCapitalLease,
                  transferOfOwnership: result.answers.transferOfOwnership,
                  bargainPurchaseOption: result.answers.bargainPurchaseOption,
                  leaseTermPct: result.answers.leaseTermPct,
                  pvPctFairValue: result.answers.pvPctFairValue,
                  fairValue: result.answers.fairValue || undefined,
                  specializedAsset: result.answers.specializedAsset,
                  capitalLeaseRationale: result.rationale,
                  assetDescription: formatAssetType(result.answers.assetType) || undefined,
                  assetUsefulLife: result.answers.economicLife || undefined,
                  monthlyPayment: result.answers.monthlyPayment,
                  termMonths: result.answers.termMonths,
                  interestRate: result.answers.interestRate,
                  downPayment: result.isCapitalLease ? result.answers.downPayment : 0,
                  principal: result.isCapitalLease
                    ? (result.pvValue > 0 ? result.pvValue : result.answers.fairValue)
                    : (slPreview?.totalLeasePayments ?? result.answers.monthlyPayment * result.answers.termMonths),
                  amortizationYears: result.answers.assetType
                    ? Math.min(Math.ceil(result.answers.termMonths / 12), Math.max(3, Math.ceil(result.answers.economicLife)))
                    : Math.ceil(result.answers.termMonths / 12),
                  termYears: Math.ceil(result.answers.termMonths / 12),
                  isOfficeProperty: result.isOfficeProperty,
                  freeRentMonths: !result.isCapitalLease ? (result.straightLine?.freeRentMonths ?? 0) : 0,
                  rentEscalationRate: !result.isCapitalLease ? (result.straightLine?.rentEscalationRate ?? 0) : 0,
                  rentSteps: !result.isCapitalLease && result.straightLine?.rentSteps?.length ? result.straightLine.rentSteps : null,
                  tenantImprovementAllowance: !result.isCapitalLease ? (result.straightLine?.tenantImprovementAllowance ?? 0) : 0,
                  camMonthly: !result.isCapitalLease && (result.straightLine?.camMonthly ?? 0) > 0 ? result.straightLine!.camMonthly : null,
                  otherInducements: !result.isCapitalLease ? (result.straightLine?.otherInducements ?? 0) : 0,
                  inducementReceivedInCash: !result.isCapitalLease ? (result.straightLine?.inducementReceivedInCash ?? false) : false,
                  ...(result.isCapitalLease && !loan.collateralType
                    ? {
                        collateralType: "equipment",
                        collateralDescription: formatAssetType(result.answers.assetType) || undefined,
                        collateralDepreciableCost: result.answers.fairValue || undefined,
                        collateralUsefulLifeYears: result.answers.economicLife || undefined,
                        collateralMethod: "straight_line",
                      }
                    : {}),
                },
              });
            }}
            initialAnswers={initialAnswers}
            initialStraightLine={{
              freeRentMonths: loan.freeRentMonths ?? 0,
              rentEscalationRate: Number(loan.rentEscalationRate ?? 0),
              rentSteps: (loan.rentSteps as Array<{ fromYear: number; toYear: number; monthlyRent: number }> | undefined) ?? [],
              tenantImprovementAllowance: Number(loan.tenantImprovementAllowance ?? 0),
              otherInducements: Number(loan.otherInducements ?? 0),
              inducementReceivedInCash: loan.inducementReceivedInCash ?? false,
              camMonthly: Number(loan.camMonthly ?? 0),
            }}
          />
        );
      })()}
      <Dialog open={eventEditorOpen} onOpenChange={setEventEditorOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Mid-term Principal Payments</DialogTitle><DialogDescription>Edit the complete draft timeline. Saving creates a successor event set; existing evidence is never patched.</DialogDescription></DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto space-y-3">
            {eventDraft.map((event, index) => (
              <div key={`${event.effectiveDate}-${index}`} className="rounded-lg border p-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                <Label>Date<Input type="date" value={event.effectiveDate.slice(0, 10)} onChange={e => setEventDraft(d => d.map((v, i) => i === index ? { ...v, effectiveDate: e.target.value } : v))} /></Label>
                <Label>Principal amount<Input type="number" min="0.01" value={event.amount} onChange={e => setEventDraft(d => d.map((v, i) => i === index ? { ...v, amount: Number(e.target.value) } : v))} /></Label>
                <Label>Same-day order<Input type="number" min="1" value={event.sequence} onChange={e => setEventDraft(d => d.map((v, i) => i === index ? { ...v, sequence: Math.max(1, Number(e.target.value)) } : v))} /></Label>
                <Label>Relative to scheduled payment<select className="w-full h-9 border rounded px-2" value={event.ordering} onChange={e => setEventDraft(d => d.map((v, i) => i === index ? { ...v, ordering: e.target.value as LoanEventInput["ordering"] } : v))}><option value="before_scheduled_payment">Before scheduled payment</option><option value="after_scheduled_payment">After scheduled payment</option></select></Label>
                <Label>Treatment<select className="w-full h-9 border rounded px-2" value={event.treatment} onChange={e => setEventDraft(d => d.map((v, i) => i === index ? { ...v, treatment: e.target.value as LoanEventInput["treatment"] } : v))}><option value="keep_payment">Keep payment / earlier payoff</option><option value="keep_maturity">Keep maturity / recast payments</option></select></Label>
                <Label>Classification<select className="w-full h-9 border rounded px-2" value={event.classification} onChange={e => setEventDraft(d => d.map((v, i) => i === index ? { ...v, classification: e.target.value as LoanEventInput["classification"] } : v))}><option value="ordinary">Ordinary contractual prepayment</option><option value="agreement_change">Agreement change</option></select></Label>
                <Label>Source<Input value={event.source} onChange={e => setEventDraft(d => d.map((v, i) => i === index ? { ...v, source: e.target.value } : v))} /></Label>
                <Label className="md:col-span-2">Reason<Input value={event.reason} onChange={e => setEventDraft(d => d.map((v, i) => i === index ? { ...v, reason: e.target.value } : v))} /></Label>
                <Button variant="ghost" className="text-destructive" onClick={() => setEventDraft(d => d.filter((_, i) => i !== index))}>Remove</Button>
              </div>
            ))}
            {eventDraft.some(e => e.classification === "agreement_change") && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Agreement-change items must be assessed in the renewal/modification workflow. They cannot be saved as ordinary principal payments.</p>}
            {eventPreview && <div className="rounded-md bg-muted p-3 text-sm grid grid-cols-2 gap-2"><b>Preview (before → after)</b><span /><span>Next payment: {formatCurrency(eventPreview.before.nextRegularPayment)} → {formatCurrency(eventPreview.after.nextRegularPayment)}</span><span>Payoff: {eventPreview.before.payoffDate ?? "—"} → {eventPreview.after.payoffDate ?? "—"}</span><span>Total interest: {formatCurrency(eventPreview.before.totalInterest)} → {formatCurrency(eventPreview.after.totalInterest)}</span><span>Ending balance: {formatCurrency(eventPreview.before.endingBalance)} → {formatCurrency(eventPreview.after.endingBalance)}</span></div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEventDraft(d => normalizeEventSequences([...d, { kind: "principal_prepayment", effectiveDate: loan.startDate.slice(0, 10), ordering: "after_scheduled_payment", sequence: d.length + 1, amount: 0, treatment: "keep_payment", classification: "ordinary", source: "Loan agreement", reason: "", authoredAt: new Date().toISOString() }]))}>Add payment</Button>
            <Label className="flex-1">Set reason<Input value={eventReason} onChange={e => setEventReason(e.target.value)} placeholder="Why this successor set is being created" /></Label>
            <Button variant="secondary" disabled={!eventReason || eventDraft.some(e => !e.effectiveDate || e.amount <= 0 || !e.source || !e.reason || e.classification === "agreement_change")} onClick={() => { const events = normalizeEventSequences(eventDraft); setEventDraft(events); previewEventSet.mutate({ id: loanId, data: { expectedVersion: loan.activeEventSetVersion, termRevisionId: loan.currentRevisionId!, reason: eventReason, source: "Loan detail", events } }); }}>Preview</Button>
            <Button disabled={!eventReason || !loan.currentRevisionId || eventDraft.some(e => !e.effectiveDate || e.amount <= 0 || !e.source || !e.reason || e.classification === "agreement_change")} onClick={() => { const events = normalizeEventSequences(eventDraft); setEventDraft(events); createEventSet.mutate({ id: loanId, data: { expectedVersion: loan.activeEventSetVersion, termRevisionId: loan.currentRevisionId!, reason: eventReason, source: "Loan detail", events } }); }}>Save successor set</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Override Loan Rate Dialog */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Override Variable Rate</DialogTitle>
            <DialogDescription>
              Record a confirmed rate observation when the automated fetch fails or the lender's contractual rate differs from the public benchmark.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Effective Date</Label>
              <Input
                type="date"
                value={overrideDate}
                onChange={(e) => setOverrideDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Benchmark Rate (%)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                max="100"
                value={overrideRate}
                onChange={(e) => setOverrideRate(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">The public rate before the loan's contractual spread is applied.</p>
            </div>
            <div className="space-y-2">
              <Label>Source URL or Document</Label>
              <Input
                value={overrideUrl}
                onChange={(e) => setOverrideUrl(e.target.value)}
                placeholder="e.g. Bank statement pg 2, or public URL"
              />
            </div>
            <div className="space-y-2">
              <Label>Reason for override</Label>
              <Input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Contractual prime differs from public BOC prime"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>Cancel</Button>
            <Button
              disabled={!overrideDate || overrideRate === "" || !overrideUrl.trim() || !overrideReason.trim() || overrideLoanRate.isPending}
              onClick={() => {
                overrideLoanRate.mutate({
                  id: loanId,
                  data: {
                    effectiveDate: overrideDate,
                    benchmarkRate: overrideRate as number,
                    sourceUrl: overrideUrl,
                    reason: overrideReason,
                    author: "Current User",
                  }
                });
              }}
            >
              {overrideLoanRate.isPending ? "Saving..." : "Save Override"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore Loan Rate Dialog */}
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restore Sourced Rate</DialogTitle>
            <DialogDescription>
              Remove the manual override effective on {restoreDate ? format(parseISO(restoreDate), "MMMM d, yyyy") : ""} and restore the automatically fetched benchmark rate. The override will remain visible in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setRestoreOpen(false)}>Cancel</Button>
            <Button
              variant="default"
              disabled={!restoreDate || restoreLoanRate.isPending}
              onClick={() => {
                restoreLoanRate.mutate({
                  id: loanId,
                  data: {
                    effectiveDate: restoreDate,
                    author: "Current User",
                  }
                });
              }}
            >
              {restoreLoanRate.isPending ? "Restoring..." : "Restore Rate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
