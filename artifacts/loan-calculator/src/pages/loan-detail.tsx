import { useState, useMemo } from "react";
import { useRoute } from "wouter";
import { Link } from "wouter";
import { useGetLoan, useGetFile, useGetClient, useUpdateLoan, useGetPrimeRate } from "@workspace/api-client-react";
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
import { ArrowLeft, Download, FileText, Calendar, Pencil, ShieldCheck, AlertTriangle, CheckCircle2, XCircle, RotateCcw, DollarSign, TrendingDown, Clock, Percent, Star, ClipboardList, ChevronDown, ChevronUp, Paperclip } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import CapitalLeaseAssessment, { formatAssetType, parseAssetType, type AssessmentAnswers, type AssessmentResult, type StraightLineAnswers } from "@/components/capital-lease-assessment";
import { PageHeader } from "@/components/page-header";
import { calculateAmortization, calculateFairValueSchedule } from "@workspace/amortization";
import { calculateStraightLineLease, buildYearlyStraightLine } from "@/lib/straight-line";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { format, addYears, isAfter, addMonths, parseISO, subMonths, subDays } from "date-fns";
import { exportScheduleXlsx, exportSchedulePdf, exportAnnualXlsx, exportAnnualPdf } from "@/lib/loan-export";
import { buildLoanWorkpaper, exportLoanWorkpaperPdf, exportLoanWorkpaperXlsx } from "@/lib/workpaper-export";
import { runLoanDiagnostics } from "@/lib/diagnostics";
import { FindingsList } from "@/components/review-findings";
import { buildAssetDepreciationSchedule } from "@/lib/aspe-utils";
import { getFiscalYear, getFyEndParts } from "@/lib/fiscal";

export default function LoanDetail() {
  const [_, params] = useRoute("/client/:id/file/:fileId/loan/:loanId");
  const clientId = params?.id ?? "";
  const fileId = params?.fileId ?? "";
  const loanId = params?.loanId ?? "";

  const [tab, setTab] = useState("schedule");
  const [fvDecisionExpanded, setFvDecisionExpanded] = useState(false);
  const [fvTab, setFvTab] = useState("actual");
  const [editOpen, setEditOpen] = useState(false);
  const [reevaluateOpen, setReevaluateOpen] = useState(false);
  const [adjEntryYear, setAdjEntryYear] = useState<number | null>(null);

  const [editForm, setEditForm] = useState<LoanFormState>({
    name: "",
    description: "",
    counterparty: null as string | null,
    isCapitalLease: false,
    principal: 0,
    downPayment: 0,
    interestRate: 0,
    amortizationYears: 0,
    termYears: 0,
    startDate: "",
    paymentFrequency: "monthly",
    ioMonths: 0,
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

  const editMode: LoanFormMode = (() => {
    if (!loan) return "loan";
    if (loan.isCapitalLease) return "capital_lease";
    if (Number(loan.interestRate) === 0 && loan.monthlyPayment != null) return "operating_lease";
    return "loan";
  })();
  const { data: file } = useGetFile(fileId);
  const { data: client } = useGetClient(clientId);

  const updateLoan = useUpdateLoan({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/loans/${loanId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/files/${fileId}/loans`] });
        setEditOpen(false);
      },
      onError: (err) => {
        toast({ title: "Couldn't save changes", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const rate = Number(loan?.interestRate ?? 0);

  /* ── ASPE 3856 Fair Value ───────────────────────────────────── */
  const isLowRate = rate > 0 && rate < 3;
  const isVeryLowRate = rate > 0 && rate < 1;

  const { data: primeData } = useGetPrimeRate(
    isLowRate && loan ? { date: parseISO(loan.startDate).toISOString().split("T")[0] } : undefined,
    { query: { enabled: isLowRate && !!loan, queryKey: ["primeRate", loan?.startDate] } as any }
  );

  const suggestedFvRate = loan?.fvRate != null
    ? Number(loan.fvRate)
    : (primeData?.suggestedRate ?? 0);

  const effectiveRate = (loan?.fvDecision === "use_fv" && suggestedFvRate > 0) ? suggestedFvRate : rate;

  const contractualResult = useMemo(() => {
    if (!loan) return null;
    return calculateAmortization(
      Number(loan.principal) - Number(loan.downPayment ?? 0),
      Number(loan.interestRate),
      loan.amortizationYears,
      loan.termYears,
      parseISO(loan.startDate),
      loan.ioMonths,
      loan.specificIoMonths ? loan.specificIoMonths.split(",").map(Number).filter((n) => !isNaN(n)) : [],
      Number(loan.balloonPayment),
      loan.paymentFrequency as "monthly" | "semi-monthly" | "bi-weekly" | "weekly",
      loan.paymentOverride != null ? Number(loan.paymentOverride) : null,
    );
  }, [loan]);

  const fvResult = useMemo(() => {
    if (!loan || !contractualResult || !suggestedFvRate || suggestedFvRate <= 0) return null;
    // Effective-interest method: the contractual payments are fixed; only the
    // principal/interest split changes at the fair-value rate.
    return calculateFairValueSchedule(
      contractualResult.schedule,
      suggestedFvRate,
      loan.paymentFrequency as "monthly" | "semi-monthly" | "bi-weekly" | "weekly",
    );
  }, [loan, contractualResult, suggestedFvRate]);

  // When fair value is adopted, the booked schedule is the effective-interest
  // schedule (contractual payments fixed, interest at the FV rate on the
  // discounted carrying amount) — never a re-amortization at the FV rate.
  const result = useMemo(() => {
    if (!loan || !contractualResult) return null;
    if (loan.fvDecision === "use_fv" && fvResult) return fvResult;
    return contractualResult;
  }, [loan, contractualResult, fvResult]);

  const fvDiff = useMemo(() => {
    if (!loan || !fvResult) return null;
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

  /* ── Cumulative FV adjusting entries per fiscal year ─────────────
     For each fiscal year end we build the "unrecorded adjustment": the
     cumulative catch-up needed to restate the loan from the unadjusted
     (contractual/face) basis to fair value. Because the client keeps the
     loan on the books at contractual amounts and the day-one discount
     unwinds over time through extra interest, the required adjustment as
     at any year end is the day-one discount less the discount already
     accreted. The P&L effect is split between prior fiscal years (opening
     retained earnings) and the current fiscal year (interest expense),
     with the initial fair-value benefit recognised at inception. Computed
     on-the-fly; never stored. */
  const adjustingEntriesByYear = useMemo(() => {
    const map = new Map<
      number,
      {
        year: number;
        label: string;
        day1Discount: number;
        priorExtra: number;
        currentExtra: number;
        cumulativeExtra: number;
        remainingDiscount: number;
      }
    >();
    if (!loan || !fvResult || fvDiff == null) return map;
    if (Math.abs(fvDiff) < 0.01) return map;
    const day1Discount = fvDiff; // face principal less discounted fair value
    let running = 0;
    for (const row of yearlyTotalsActual) {
      const fv = yearlyTotalsFv.find((r) => r.year === row.year);
      const currentExtra = fv ? Number((fv.interest - row.interest).toFixed(2)) : 0;
      const priorExtra = Number(running.toFixed(2));
      running += currentExtra;
      const cumulativeExtra = Number(running.toFixed(2));
      const remainingDiscount = Number((day1Discount - cumulativeExtra).toFixed(2));
      map.set(row.year, {
        year: row.year,
        label: row.label,
        day1Discount,
        priorExtra,
        currentExtra,
        cumulativeExtra,
        remainingDiscount,
      });
    }
    return map;
  }, [loan, fvResult, fvDiff, yearlyTotalsActual, yearlyTotalsFv]);


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

  const downloadExcel = () => {
    if (!result) return;
    exportScheduleXlsx(loan?.name ?? "Loan", result.schedule);
  };

  const downloadPDF = () => {
    if (!result || !loan) return;
    exportSchedulePdf(
      {
        name: loan.name,
        principal: Number(loan.principal),
        interestRate: Number(loan.interestRate),
        termYears: loan.termYears,
      },
      result.schedule,
    );
  };

  const downloadAnnualExcel = () => {
    if (!yearlyTotals.length) return;
    exportAnnualXlsx(loan?.name ?? "Loan", yearlyTotals);
  };

  const downloadAnnualPDF = () => {
    if (!yearlyTotals.length || !loan) return;
    exportAnnualPdf(loan.name, yearlyTotals);
  };

  const loanDiagnostics = useMemo(() => {
    if (!loan || !file?.fiscalYearEnd) return null;
    return runLoanDiagnostics(loan, {
      fiscalYearEnd: file.fiscalYearEnd,
      trivialThreshold: file.trivialThreshold,
      materiality: file.materiality,
    });
  }, [loan, file]);

  const setFindingDismissed = (findingId: string, dismiss: boolean) => {
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
      amortizationYears: loan.amortizationYears,
      termYears: loan.termYears,
      startDate: loan.startDate.split("T")[0],
      paymentFrequency: loan.paymentFrequency as any,
      ioMonths: loan.ioMonths,
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
    setEditOpen(true);
  };

  const downloadWorkpaper = (kind: "pdf" | "xlsx") => {
    if (!loan || !file?.fiscalYearEnd) return;
    const wp = buildLoanWorkpaper(loan, {
      clientName: client?.name ?? "Client",
      fiscalYearEnd: file.fiscalYearEnd,
    });
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
              const isOperatingLease = !loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null;
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
            const isLease = loan.isCapitalLease || (!loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null);
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
        <main className="space-y-6">
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
                  onDismiss={(id) => setFindingDismissed(id, true)}
                  onRestore={(id) => setFindingDismissed(id, false)}
                />
              </CardContent>
            </Card>
          )}

          {/* ASPE 3856 Low-Rate Warning */}
          {isLowRate && (
            <div className={`rounded-lg border p-4 flex items-start gap-3 ${isVeryLowRate ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
              <div className="mt-0.5 shrink-0">
                <AlertTriangle className={`h-5 w-5 ${isVeryLowRate ? "text-red-600" : "text-amber-600"}`} />
              </div>
              <div className="space-y-2 w-full">
                <p className={`text-sm font-semibold ${isVeryLowRate ? "text-red-900" : "text-amber-900"}`}>
                  {isVeryLowRate ? "Very Low Interest Rate — ASPE 3856 Fair Value Adjustment Required" : "Low Interest Rate — ASPE 3856 Fair Value Adjustment May Be Required"}
                </p>
                <p className={`text-xs ${isVeryLowRate ? "text-red-800" : "text-amber-800"}`}>
                  The contractual rate of {rate.toFixed(2)}% is below the market threshold. ASPE 3856 requires that loans/leases with below-market rates be recorded at fair value using an imputed rate.
                </p>
                {suggestedFvRate > 0 && (
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <span className="text-xs font-medium">Suggested FV rate: {suggestedFvRate.toFixed(2)}% (prime + 2%)</span>
                    {fvDiff != null && (
                      <span className="text-xs font-medium">
                        FV adjustment: ${Math.abs(fvDiff).toLocaleString()} ({fvDiff >= 0 ? "higher" : "lower"})
                      </span>
                    )}
                  </div>
                )}
                {loan?.fvRate == null && primeData?.source === "Fallback default" && (
                  <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 mt-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-700 mt-0.5 shrink-0" />
                    <span className="text-xs text-red-800">
                      The live Bank of Canada prime rate could not be retrieved for this date, so a default of 7.20% (prime) was used to derive the suggested fair-value rate above. Verify the rate against the actual prime rate at the loan's start date before relying on this adjustment.
                    </span>
                  </div>
                )}
                {/* Three-way FV decision */}
                <div className="pt-2">
                  {loan.fvDecision && !fvDecisionExpanded ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 rounded-md border p-2 bg-white/60">
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                          <span className="text-xs font-semibold truncate">
                            FV Treatment Decision:{" "}
                            {loan.fvDecision === "use_fv"
                              ? "Use fair value rate (material)"
                              : loan.fvDecision === "trivial"
                                ? "Trivial — document only"
                                : "Immaterial but non-trivial — track as unadjusted misstatement"}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 text-xs shrink-0"
                          onClick={() => setFvDecisionExpanded(true)}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                          Change
                        </Button>
                      </div>
                      {loan.fvDecisionNote && (
                        <p className="text-[11px] text-muted-foreground rounded-md border bg-white/60 p-2">
                          {loan.fvDecisionNote}
                        </p>
                      )}
                    </div>
                  ) : (
                  <>
                  <div className="flex items-center gap-2 mb-1">
                    <Label className="text-xs font-semibold block">FV Treatment Decision</Label>
                    {loan.fvDecision && (
                      <span className="text-[10px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                        Auto-suggested — override if needed
                      </span>
                    )}
                    {loan.fvDecision && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 gap-1 text-xs ml-auto"
                        onClick={() => setFvDecisionExpanded(false)}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                        Minimize
                      </Button>
                    )}
                  </div>
                  <RadioGroup
                    value={loan.fvDecision ?? ""}
                    onValueChange={(val) => {
                      const decision = val as "use_fv" | "trivial" | "immaterial";
                      const diffText = fvDiff != null ? `$${Math.abs(fvDiff).toLocaleString()}` : "The fair value difference";
                      const autoNote =
                        decision === "trivial"
                          ? `FV difference of ${diffText} is below the trivial threshold${file?.trivialThreshold != null ? ` of $${Number(file.trivialThreshold).toLocaleString()}` : ""} — contractual rate retained, no adjustment recorded.`
                          : decision === "immaterial"
                            ? `FV difference of ${diffText} is below materiality${file?.materiality != null ? ` of $${Number(file.materiality).toLocaleString()}` : ""} but above trivial — tracked on the unadjusted misstatement schedule, no adjustment booked.`
                            : undefined;
                      updateLoan.mutate({
                        id: loanId,
                        data: {
                          fvDecision: decision,
                          fvRate: suggestedFvRate,
                          ...(autoNote ? { fvDecisionNote: autoNote } : {}),
                        },
                      });
                      setFvDecisionExpanded(false);
                    }}
                    className="gap-2"
                  >
                    <div className="flex items-start gap-2 rounded-md border p-2 bg-white/60">
                      <RadioGroupItem value="use_fv" id="fv-use" className="mt-0.5" />
                      <div className="space-y-0.5">
                        <Label htmlFor="fv-use" className="text-xs font-medium cursor-pointer">
                          Use fair value rate (material)
                        </Label>
                        <p className="text-[11px] text-muted-foreground">Apply the FV rate to the amortization schedule and financial statements.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 rounded-md border p-2 bg-white/60">
                      <RadioGroupItem value="trivial" id="fv-trivial" className="mt-0.5" />
                      <div className="space-y-0.5">
                        <Label htmlFor="fv-trivial" className="text-xs font-medium cursor-pointer">
                          Trivial — document only
                        </Label>
                        <p className="text-[11px] text-muted-foreground">Below trivial threshold. Keep contractual rate; add a note to working papers.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 rounded-md border p-2 bg-white/60">
                      <RadioGroupItem value="immaterial" id="fv-immaterial" className="mt-0.5" />
                      <div className="space-y-0.5">
                        <Label htmlFor="fv-immaterial" className="text-xs font-medium cursor-pointer">
                          Immaterial but non-trivial — track as unadjusted misstatement
                        </Label>
                        <p className="text-[11px] text-muted-foreground">Above trivial but below materiality. Log in the unadjusted misstatement schedule.</p>
                      </div>
                    </div>
                  </RadioGroup>
                  {loan.fvDecision && loan.fvDecisionNote && (
                    <p className="text-[11px] text-muted-foreground rounded-md border bg-white/60 p-2 mt-2">
                      {loan.fvDecisionNote}
                    </p>
                  )}
                  {loan.fvDecision === "trivial" && (file?.trivialThreshold == null) && (
                    <p className="text-[11px] text-amber-700 pt-1">
                      Set a trivial threshold on the year-end file to auto-drive this decision.
                    </p>
                  )}
                  {loan.fvDecision === "immaterial" && (file?.materiality == null) && (
                    <p className="text-[11px] text-amber-700 pt-1">
                      Set a materiality threshold on the year-end file to auto-drive this decision.
                    </p>
                  )}
                  </>
                  )}
                </div>
              </div>
            </div>
          )}

          {loan.isCapitalLease || (Number(loan.interestRate) > 0 && Number(loan.principal) > 0 && !loan.monthlyPayment) ? (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="gap-1 p-1 bg-muted/60 flex-wrap">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <TabsTrigger value="schedule">Schedule</TabsTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Full period-by-period amortization schedule</TooltipContent>
                </Tooltip>
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
                              key={row.month}
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
                        <span className="font-semibold">{Number(loan.interestRate).toFixed(2)}%</span>
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
                                  <TableRow key={row.month} className={i % 2 === 1 ? "bg-muted/20" : ""}>
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
                                  <TableRow key={row.month} className={i % 2 === 1 ? "bg-muted/20" : ""}>
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
                              const hasAdjEntry = adjustingEntriesByYear.has(row.year);
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
            const isOperatingLease = loan && !loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null;
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
            const adj = adjEntryYear != null ? adjustingEntriesByYear.get(adjEntryYear) : undefined;
            if (!adj) return null;
            const liabilityLabel = loan?.isCapitalLease
              ? "Obligation under Capital Lease"
              : "Loan Payable";
            // Positive amount => debit, negative => credit.
            // Retained earnings absorbs both the day-one fair-value benefit
            // (credit) and any prior-year interest accretion (debit); netting
            // them keeps a single RE line. Signed = priorExtra - day1Discount.
            const retainedEarnings = Number((adj.priorExtra - adj.day1Discount).toFixed(2));
            const reNote =
              Math.abs(adj.priorExtra) >= 0.01
                ? "Initial fair-value benefit, net of prior-year interest accretion"
                : "Initial fair-value benefit recognized at inception";
            const lines: { account: string; note: string; amount: number }[] = [
              {
                account: liabilityLabel,
                note: "Restate carrying amount to fair value (remaining unamortized discount)",
                amount: adj.remainingDiscount,
              },
              {
                account: "Interest Expense",
                note: "Current-year fair-value interest accretion",
                amount: adj.currentExtra,
              },
              {
                account: "Retained Earnings (opening)",
                note: reNote,
                amount: retainedEarnings,
              },
            ];
            const totalDebit = lines.reduce((s, l) => s + (l.amount > 0 ? l.amount : 0), 0);
            const totalCredit = lines.reduce((s, l) => s + (l.amount < 0 ? -l.amount : 0), 0);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="font-display flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Adjusting Journal Entry — {adj.label}
                  </DialogTitle>
                  <DialogDescription>
                    Cumulative unrecorded fair-value adjustment (ASPE 3856) as at this fiscal
                    year end, restating the loan from the unadjusted (contractual) basis to
                    fair value. Includes prior-year catch-up where applicable. Computed
                    on-the-fly for working-paper documentation.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Day-one FV difference</div>
                      <div className="font-semibold">{formatCurrency(adj.day1Discount)}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Accreted to date</div>
                      <div className="font-semibold">{formatCurrency(adj.cumulativeExtra)}</div>
                    </div>
                    <div className="rounded-lg border p-3">
                      <div className="text-xs text-muted-foreground">Remaining discount</div>
                      <div className="font-semibold">{formatCurrency(adj.remainingDiscount)}</div>
                    </div>
                  </div>

                  <div className="rounded-lg border overflow-hidden text-sm">
                    <div className="bg-muted/40 p-2 text-xs font-medium text-muted-foreground">
                      Proposed adjusting entry — {adj.label}
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
                        {lines.map((line, idx) => (
                          <tr key={idx} className="border-t align-top">
                            <td className="p-2">
                              <div className="font-medium">{line.account}</div>
                              <div className="text-xs text-muted-foreground">{line.note}</div>
                            </td>
                            <td className="p-2 text-right whitespace-nowrap">
                              {line.amount > 0 ? formatCurrency(line.amount) : ""}
                            </td>
                            <td className="p-2 text-right whitespace-nowrap">
                              {line.amount < 0 ? formatCurrency(-line.amount) : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/30 font-semibold">
                          <td className="p-2 text-right">Totals</td>
                          <td className="p-2 text-right whitespace-nowrap">{formatCurrency(totalDebit)}</td>
                          <td className="p-2 text-right whitespace-nowrap">{formatCurrency(totalCredit)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="bg-muted/50 border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
                    <p>
                      <strong>Basis:</strong> The client's records carry the loan at the
                      contractual (face) basis. This entry flags the unadjusted difference
                      between actual and fair value as at {adj.label.toLowerCase()}. The
                      balance-sheet line equals the remaining unamortized discount; the
                      current-year interest accretion is taken to interest expense.
                    </p>
                    <p>
                      <strong>Retained earnings:</strong> The initial fair-value benefit and any
                      prior-year interest accretion are both taken to opening retained earnings
                      (shown net). Here that is the ${formatCurrency(adj.day1Discount)} day-one
                      benefit{Math.abs(adj.priorExtra) >= 0.01 ? ` less ${formatCurrency(adj.priorExtra)} of prior-year accretion` : ""}.
                    </p>
                  </div>
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
                      interestRate: editForm.interestRate,
                      amortizationYears: editForm.amortizationYears,
                      termYears: editForm.termYears,
                      startDate: editForm.startDate,
                      paymentFrequency: editForm.paymentFrequency,
                      ioMonths: editForm.ioMonths,
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
                      fvRate: editForm.fvRate,
                      fvDecision: editForm.fvDecision,
                      fvDecisionNote: editForm.fvDecisionNote || undefined,
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
                    },
                  });
                }
              }}
              disabled={validateLoanForm(editForm, editMode) !== null || updateLoan.isPending}
            >
              {updateLoan.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reevaluate Lease Wizard */}
      {(() => {
        if (!loan) return null;
        const isLease = loan.isCapitalLease || (!loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null);
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
    </div>
  );
}
