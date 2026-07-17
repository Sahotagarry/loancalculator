import { Fragment, useState } from "react";
import { useRoute } from "wouter";
import { Link } from "wouter";
import { useGetFile, useGetClient, useGetLoan, useListFiles, useListLoans, useCreateLoan, useDeleteLoan, useUpdateLoan, useUpdateFile, useRollForwardFile, getGetLoanQueryKey, getListFilesQueryKey, getListLoansQueryKey } from "@workspace/api-client-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import ConfirmDialog from "@/components/confirm-dialog";
import { CounterpartyCombobox } from "@/components/counterparty-combobox";
import { LoanFormFields, validateLoanForm, type LoanFormState, type LoanFormMode } from "@/components/loan-form-fields";
import { ArrowLeft, ArrowRight, Plus, Trash2, Calculator, FileSpreadsheet, Calendar, Pencil, CheckCircle2, XCircle, ShieldCheck, AlertTriangle, FileText, Landmark, Receipt, Wallet, CalendarPlus, LayoutGrid, Table as TableIcon, ChevronDown, Search } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useMemo } from "react";
import { calculateStraightLineLease, buildYearlyStraightLine } from "@/lib/straight-line";
import { exportFileWorkpapersPdf, exportFileWorkpapersXlsx, exportFileLeadSheetPdf, exportFileLeadSheetXlsx } from "@/lib/workpaper-export";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { runFileDiagnostics } from "@/lib/diagnostics";
import { FindingsList } from "@/components/review-findings";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { format, addYears, addMonths, isAfter, parseISO } from "date-fns";
import {
  buildFileSummary,
  calculateBookedSchedule,
  computeMaturityDate,
  type FileSummary,
  type LoanSummary,
  type CapitalLeaseSummary,
  type OperatingLeaseSummary,
} from "@/lib/aspe-utils";
import CapitalLeaseAssessment, { calculatePVFromAnswers, formatAssetType, parseAssetType, type AssessmentResult, type StraightLineAnswers, type AssessmentAnswers, type ImportedEstimates } from "@/components/capital-lease-assessment";
import ImportDocumentDialog from "@/components/import-document-dialog";
import type { DocumentImportResult } from "@workspace/api-client-react";
import { FileUp } from "lucide-react";

function groupByCounterparty<T extends { counterparty: string | null }>(
  items: T[],
  getAmount?: (item: T) => number,
): Array<{ key: string; label: string; items: T[] }> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.counterparty?.trim() || "__other__";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return Array.from(groups.entries())
    .map(([key, groupItems]) => ({
      key,
      label: key === "__other__" ? "Other" : key,
      items: getAmount
        ? [...groupItems].sort((a, b) => getAmount(b) - getAmount(a))
        : groupItems,
    }))
    .sort((a, b) => {
      if (a.key === "__other__") return 1;
      if (b.key === "__other__") return -1;
      if (getAmount) {
        const totalA = a.items.reduce((s, i) => s + getAmount(i), 0);
        const totalB = b.items.reduce((s, i) => s + getAmount(i), 0);
        if (totalA !== totalB) return totalB - totalA;
      }
      return a.label.localeCompare(b.label);
    });
}

function makeBlankLoanForm(): LoanFormState {
  return {
    name: "",
    description: "",
    counterparty: null,
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
    monthlyPayment: undefined,
    paymentOverride: undefined,
    termMonths: undefined,
    isOfficeProperty: false,
    freeRentMonths: 0,
    rentEscalationRate: 0,
    rentSteps: [],
    tenantImprovementAllowance: 0,
    otherInducements: 0,
    inducementReceivedInCash: false,
    covenantViolation: false,
    fvRate: undefined,
    fvDecision: undefined,
    fvDecisionNote: "",
    securityClauses: [],
    collateralType: "",
    collateralDescription: "",
    collateralDepreciableCost: 0,
    collateralLandCost: 0,
    collateralInServiceDate: "",
    collateralMethod: "straight_line",
    collateralUsefulLifeYears: 0,
    collateralDecliningRate: 0,
    collateralSalvageValue: 0,
  };
}

export default function FileDetail() {
  const [_, params] = useRoute("/client/:id/file/:fileId");
  const clientId = params?.id ?? "";
  const fileId = params?.fileId ?? "";

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [loanTab, setLoanTab] = useState("loans");
  const [editFileName, setEditFileName] = useState("");
  const [editFileYearEnd, setEditFileYearEnd] = useState("");
  const [editTrivialThreshold, setEditTrivialThreshold] = useState<number | undefined>(undefined);
  const [editMateriality, setEditMateriality] = useState<number | undefined>(undefined);
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [assessmentResult, setAssessmentResult] = useState<AssessmentResult | null>(null);
  const [operatingDialogOpen, setOperatingDialogOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [operatingLeaseResult, setOperatingLeaseResult] = useState<AssessmentResult | null>(null);
  const [operatingStartDate, setOperatingStartDate] = useState("");
  const [operatingCounterparty, setOperatingCounterparty] = useState<string | null>(null);
  const [rollForwardOpen, setRollForwardOpen] = useState(false);
  const [newYearEnd, setNewYearEnd] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [pendingSourceDoc, setPendingSourceDoc] = useState<{ blob: string; name: string } | null>(null);
  const [importedAnswers, setImportedAnswers] = useState<AssessmentAnswers | undefined>(undefined);
  const [importedStraightLine, setImportedStraightLine] = useState<StraightLineAnswers | undefined>(undefined);
  const [importedNotes, setImportedNotes] = useState<Record<string, string> | null>(null);
  const [importedPercentageRent, setImportedPercentageRent] = useState<string | null>(null);
  const [importedEstimates, setImportedEstimates] = useState<ImportedEstimates | null>(null);

  const [form, setForm] = useState<LoanFormState>(() => makeBlankLoanForm());

  const [loanView, setLoanView] = useState<"cards" | "table">("cards");
  const [summaryView, setSummaryView] = useState<"combined" | "byloan">("combined");
  const [loanSort, setLoanSort] = useState("default");
  const [loanSearch, setLoanSearch] = useState("");
  const [showMatured, setShowMatured] = useState(false);

  const { data: file } = useGetFile(fileId);
  const { data: client } = useGetClient(clientId);
  const { data: loans } = useListLoans(fileId);

  const formMode: LoanFormMode = (() => {
    if (!editingLoanId) return "loan";
    const loan = loans?.find((l) => l.id === editingLoanId);
    if (!loan) return "loan";
    if (loan.isCapitalLease) return "capital_lease";
    if (Number(loan.interestRate) === 0 && loan.monthlyPayment != null) return "operating_lease";
    return "loan";
  })();

  const openEditLoan = (loan: any) => {
    setEditingLoanId(loan.id);
    setForm({
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
    setCreateOpen(true);
  };

  const [importedLeaseMeta, setImportedLeaseMeta] = useState<{ name: string; lessor: string | null; startDate: string } | null>(null);

  const handleImportedLoan = (result: DocumentImportResult) => {
    const f = result.loan;
    setPendingSourceDoc(
      result.documentBlob ? { blob: result.documentBlob, name: result.documentName ?? "document.pdf" } : null,
    );
    const validFreqs = ["monthly", "semi-monthly", "bi-weekly", "weekly"] as const;
    const freq = validFreqs.find((v) => v === f?.paymentFrequency) ?? "monthly";
    setForm({
      ...makeBlankLoanForm(),
      name: f?.name ?? "",
      description: f?.securityDescription ?? "",
      counterparty: f?.lender ?? null,
      principal: f?.principal ?? 0,
      downPayment: f?.downPayment ?? 0,
      interestRate: f?.interestRate ?? 0,
      amortizationYears: f?.amortizationYears ?? f?.termYears ?? 0,
      termYears: f?.termYears ?? f?.amortizationYears ?? 0,
      startDate: f?.startDate ?? "",
      paymentFrequency: freq,
      ioMonths: f?.interestOnlyMonths ?? 0,
      balloonPayment: f?.balloonPayment ?? 0,
      paymentOverride: f?.paymentAmount ?? undefined,
    });
    setEditingLoanId(null);
    setCreateOpen(true);
  };

  const handleImportedLease = (result: DocumentImportResult) => {
    const f = result.lease;
    setPendingSourceDoc(
      result.documentBlob ? { blob: result.documentBlob, name: result.documentName ?? "document.pdf" } : null,
    );
    const termMonths = f?.termMonths ?? 0;
    const economicLife = f?.economicLifeYears ?? 0;
    const answers: AssessmentAnswers = {
      transferOfOwnership: f?.transferOfOwnership ?? false,
      bargainPurchaseOption: f?.bargainPurchaseOption ?? false,
      leaseTermPct:
        economicLife > 0 && termMonths > 0
          ? Math.round(((termMonths / 12) / economicLife) * 1000) / 10
          : 0,
      pvPctFairValue: 0,
      fairValue: f?.fairValue ?? 0,
      specializedAsset: f?.specializedAsset ?? false,
      assetType: parseAssetType(f?.assetType ?? ""),
      economicLife,
      termMonths,
      monthlyPayment: f?.monthlyPayment ?? 0,
      downPayment: f?.downPayment ?? 0,
      interestRate: f?.interestRate ?? 0,
      paymentAtBeginning: f?.paymentAtBeginning ?? false,
      paymentIncludesTax: false,
      taxType: "none",
      taxRate: 0,
      buyoutForImplicitRate: f?.buyoutAmount ?? 0,
    };
    const pv = calculatePVFromAnswers(answers);
    if (pv > 0 && answers.fairValue > 0) {
      answers.pvPctFairValue = Math.round((pv / answers.fairValue) * 1000) / 10;
    }
    setImportedAnswers(answers);
    const hasSLData =
      (f?.freeRentMonths ?? 0) > 0 ||
      (f?.tenantImprovementAllowance ?? 0) > 0 ||
      (f?.rentSteps?.length ?? 0) > 0 ||
      (f?.camMonthly ?? 0) > 0;
    setImportedStraightLine(
      hasSLData
        ? {
            freeRentMonths: f?.freeRentMonths ?? 0,
            rentEscalationRate: 0,
            rentSteps: (f?.rentSteps ?? []).map((s) => ({
              fromYear: s.fromYear,
              toYear: s.toYear,
              monthlyRent: s.monthlyRent,
            })),
            tenantImprovementAllowance: f?.tenantImprovementAllowance ?? 0,
            otherInducements: 0,
            inducementReceivedInCash: false,
            camMonthly: f?.camMonthly ?? 0,
          }
        : undefined,
    );
    setImportedLeaseMeta({
      name: f?.name ?? "",
      lessor: f?.lessor ?? null,
      startDate: f?.startDate ?? "",
    });
    setImportedNotes(f?.fieldNotes ?? null);
    setImportedEstimates(f?.estimates ?? null);
    setImportedPercentageRent(f?.percentageRentNote ?? null);
    setAssessmentOpen(true);
  };

  const getStatusBadges = (loan: any): { label: string; cls: string; tooltip: string }[] => {
    const badges: { label: string; cls: string; tooltip: string }[] = [];
    if (!file?.fiscalYearEnd || !loan.startDate) return badges;
    const fye = parseISO(file.fiscalYearEnd);
    const windowEnd = addYears(fye, 1);
    const isOperatingLease = !loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null;
    const maturity = computeMaturityDate(loan.startDate, loan.termYears, loan.termMonths);
    if (isNaN(maturity.getTime())) return badges;

    if (isOperatingLease) {
      if (!isAfter(maturity, fye)) {
        badges.push({ label: "Expired", cls: "text-slate-600 bg-slate-100", tooltip: `Lease term ended ${format(maturity, "MMM d, yyyy")}, on or before this fiscal year end` });
      } else if (!isAfter(maturity, windowEnd)) {
        badges.push({ label: "Expires ≤ 1 yr", cls: "text-amber-800 bg-amber-100", tooltip: `Lease term ends ${format(maturity, "MMM d, yyyy")}, within 12 months of the fiscal year end` });
      }
      return badges;
    }

    if (loan.covenantViolation) {
      badges.push({ label: "Covenant Violation", cls: "text-red-700 bg-red-100", tooltip: "A financial covenant has been violated — the counterparty can demand repayment, so the entire obligation is classified as current" });
    }
    if (!isAfter(maturity, fye)) {
      badges.push({ label: "Matured", cls: "text-slate-600 bg-slate-100", tooltip: `Fully matured ${format(maturity, "MMM d, yyyy")}, on or before this fiscal year end` });
      return badges;
    }
    if (!isAfter(maturity, windowEnd)) {
      badges.push({ label: "Matures ≤ 1 yr", cls: "text-amber-800 bg-amber-100", tooltip: `Matures ${format(maturity, "MMM d, yyyy")} — within 12 months of year end, so the balance is fully current` });
      if (Number(loan.balloonPayment ?? 0) > 0) {
        badges.push({ label: "Balloon due", cls: "text-rose-700 bg-rose-100", tooltip: `Balloon payment of ${formatCurrency(Number(loan.balloonPayment))} due at maturity within the next 12 months` });
      }
    }
    if ((loan.ioMonths ?? 0) > 0) {
      const ioEnd = addMonths(parseISO(loan.startDate), loan.ioMonths);
      if (isAfter(ioEnd, fye)) {
        badges.push({ label: "Interest-only", cls: "text-slate-700 bg-slate-200", tooltip: `In its interest-only period until ${format(ioEnd, "MMM d, yyyy")} — no principal reduction yet` });
      }
    }
    return badges;
  };

  const isMaturedLoan = (loan: any): boolean => {
    if (!file?.fiscalYearEnd || !loan.startDate) return false;
    const maturity = computeMaturityDate(loan.startDate, loan.termYears, loan.termMonths);
    if (isNaN(maturity.getTime())) return false;
    return !isAfter(maturity, parseISO(file.fiscalYearEnd));
  };
  const maturedCount = (loans ?? []).filter(isMaturedLoan).length;

  const renderStatusBadges = (loan: any) =>
    getStatusBadges(loan).map((b) => (
      <Tooltip key={b.label}>
        <TooltipTrigger asChild>
          <span tabIndex={0} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${b.cls}`}>
            {b.label}
            <span className="sr-only">: {b.tooltip}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{b.tooltip}</TooltipContent>
      </Tooltip>
    ));

  const createLoan = useCreateLoan({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/files/${fileId}/loans`] });
        setCreateOpen(false);
        setForm(makeBlankLoanForm());
        setPendingSourceDoc(null);
      },
      onError: (err) => {
        toast({ title: "Couldn't save loan", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const deleteLoan = useDeleteLoan({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/files/${fileId}/loans`] });
        setDeleteOpen(false);
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast({ title: "Couldn't delete loan", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const updateLoan = useUpdateLoan({
    mutation: {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: [`/api/files/${fileId}/loans`] });
        queryClient.invalidateQueries({ queryKey: [`/api/loans/${variables.id}`] });
        setCreateOpen(false);
        setEditingLoanId(null);
      },
      onError: (err) => {
        toast({ title: "Couldn't save changes", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const updateFile = useUpdateFile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/files/${fileId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/files`] });
        // Loans carry a copy of the file's fiscal year end, which the server
        // syncs on update — refetch them so schedules recompute.
        queryClient.invalidateQueries({ queryKey: [`/api/files/${fileId}/loans`] });
        queryClient.invalidateQueries({
          predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/loans/"),
        });
        setEditOpen(false);
      },
      onError: (err) => {
        toast({ title: "Couldn't update file", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const rollForward = useRollForwardFile({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/clients/${clientId}/files`] });
        setRollForwardOpen(false);
        setNewYearEnd("");
      },
      onError: (err) => {
        toast({ title: "Couldn't roll forward file", description: getErrorMessage(err), variant: "destructive" });
      },
    },
  });

  const summary = useMemo(() => {
    if (!loans || !file?.fiscalYearEnd) return null;
    return buildFileSummary(loans, file.fiscalYearEnd);
  }, [loans, file]);

  // Prior-year comparatives: only for files created via roll-forward.
  // Follow the actual roll-forward lineage: a rolled-forward loan points at
  // its source loan (rolledFromId), and that source loan's file is the prior
  // year-end file — never guess by fiscal-year date.
  const rolledFromLoanId = useMemo(
    () => (loans ?? []).find((l) => l.rolledFromId != null)?.rolledFromId ?? null,
    [loans],
  );
  const { data: sourceLoan } = useGetLoan(rolledFromLoanId ?? "", {
    query: { queryKey: getGetLoanQueryKey(rolledFromLoanId ?? ""), enabled: !!rolledFromLoanId, retry: false },
  });
  const { data: clientFiles } = useListFiles(clientId ?? "", {
    query: { queryKey: getListFilesQueryKey(clientId ?? ""), enabled: !!clientId && !!sourceLoan },
  });
  const priorFile = useMemo(() => {
    if (!sourceLoan?.fileId || !clientFiles) return null;
    return clientFiles.find((f) => f.id === sourceLoan.fileId && f.id !== fileId) ?? null;
  }, [sourceLoan, clientFiles, fileId]);
  const { data: priorLoans } = useListLoans(priorFile?.id ?? "", {
    query: { queryKey: getListLoansQueryKey(priorFile?.id ?? ""), enabled: !!priorFile },
  });
  const priorSummary = useMemo(() => {
    if (!priorFile?.fiscalYearEnd || !priorLoans) return null;
    return buildFileSummary(priorLoans, priorFile.fiscalYearEnd);
  }, [priorFile, priorLoans]);

  const diagnostics = useMemo(() => {
    if (!loans || !file?.fiscalYearEnd) return null;
    return runFileDiagnostics(
      { fiscalYearEnd: file.fiscalYearEnd, trivialThreshold: file.trivialThreshold, materiality: file.materiality, dismissedFindings: file.dismissedFindings },
      loans,
    );
  }, [loans, file]);

  const setFileDismissed = (findingId: string, dismiss: boolean) => {
    if (!file) return;
    const current = file.dismissedFindings ?? [];
    const next = dismiss ? Array.from(new Set([...current, findingId])) : current.filter((id) => id !== findingId);
    updateFile.mutate({ id: fileId, data: { dismissedFindings: next } });
  };

  const setLoanDismissed = (loanId: string, findingId: string, dismiss: boolean) => {
    const loan = loans?.find((l) => l.id === loanId);
    if (!loan) return;
    const current = loan.dismissedFindings ?? [];
    const next = dismiss ? Array.from(new Set([...current, findingId])) : current.filter((id) => id !== findingId);
    updateLoan.mutate({ id: loanId, data: { dismissedFindings: next } });
  };

  const fileStats = useMemo(() => {
    if (!loans || !file?.fiscalYearEnd) return null;
    const fye = parseISO(file.fiscalYearEnd);
    const windowEnd = addYears(fye, 1);
    const isOperating = (l: (typeof loans)[number]) =>
      !l.isCapitalLease && Number(l.interestRate) === 0 && l.monthlyPayment != null;
    const debtItems = loans.filter((l) => !isOperating(l));
    const fvFlagged = loans.filter((l) => l.fvDecision != null).length;
    const maturingSoon = debtItems.filter((l) => {
      if (!l.startDate) return false;
      const maturity = computeMaturityDate(l.startDate, l.termYears, l.termMonths);
      if (isNaN(maturity.getTime())) return false;
      // Maturing within the 12 months following the fiscal year end.
      return isAfter(maturity, fye) && !isAfter(maturity, windowEnd);
    }).length;
    return { fvFlagged, maturingSoon, debtCount: debtItems.length };
  }, [loans, file]);


  return (
    <div className="min-h-screen bg-background">
      <PageHeader
        backHref={`/client/${clientId}`}
        breadcrumb={
          <>
            <Link href="/" className="hover:text-foreground transition-colors font-semibold cursor-pointer">Clients</Link>
            <span className="text-border">/</span>
            <Link href={`/client/${clientId}`} className="hover:text-foreground transition-colors cursor-pointer">{client?.name ?? "Client"}</Link>
            <span className="text-border">/</span>
            <span className="text-foreground font-semibold">{file?.fiscalYearEnd ? format(parseISO(file.fiscalYearEnd), "MMM d, yyyy") + " FYE" : (file?.name ?? "Year-End File")}</span>
          </>
        }
        title={file?.fiscalYearEnd ? format(parseISO(file.fiscalYearEnd), "MMMM d, yyyy") : "Year-End File"}
        meta={
          <span className="inline-flex items-center gap-2 text-sm">
            {file?.name && <span className="font-medium text-muted-foreground">{file.name}</span>}
            {file?.trivialThreshold != null && (
              <span className="hidden lg:inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                Trivial: ${Number(file.trivialThreshold).toLocaleString()}
              </span>
            )}
            {file?.materiality != null && (
              <span className="hidden lg:inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
                Materiality: ${Number(file.materiality).toLocaleString()}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2" disabled={!loans || loans.length === 0}>
                      <TableIcon className="h-4 w-4" />
                      Summary Schedule
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Export the debt &amp; lease lead sheet (summary of all loans/leases)</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    if (!file || !loans || loans.length === 0) return;
                    exportFileLeadSheetXlsx({
                      clientName: client?.name ?? "Client",
                      fiscalYearEnd: file.fiscalYearEnd,
                      loans,
                    });
                  }}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (!file || !loans || loans.length === 0) return;
                    exportFileLeadSheetPdf({
                      clientName: client?.name ?? "Client",
                      fiscalYearEnd: file.fiscalYearEnd,
                      loans,
                    });
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  PDF
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2" disabled={!loans || loans.length === 0}>
                      <FileSpreadsheet className="h-4 w-4" />
                      Workpapers
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Export engagement workpapers (lead sheet + all loans/leases)</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    if (!file || !loans || loans.length === 0) return;
                    exportFileWorkpapersXlsx({
                      clientName: client?.name ?? "Client",
                      fiscalYearEnd: file.fiscalYearEnd,
                      loans,
                    });
                  }}
                >
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                  Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    if (!file || !loans || loans.length === 0) return;
                    exportFileWorkpapersPdf({
                      clientName: client?.name ?? "Client",
                      fiscalYearEnd: file.fiscalYearEnd,
                      loans,
                    });
                  }}
                >
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
                  onClick={() => {
                    if (!file) return;
                    setEditFileName(file.name);
                    setEditFileYearEnd(file.fiscalYearEnd.split("T")[0]);
                    setEditTrivialThreshold(file.trivialThreshold ?? undefined);
                    setEditMateriality(file.materiality ?? undefined);
                    setEditOpen(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  Edit
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit fiscal year end, reference name, and thresholds</TooltipContent>
            </Tooltip>
          </div>
        }
      />
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <main className="space-y-6">

          {summary && fileStats && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-muted border flex items-center justify-center flex-shrink-0">
                    <Landmark className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Total Debt Outstanding</p>
                    <p className="text-lg font-bold tracking-tight">{formatCurrency(summary.totalDebt)}</p>
                    <p className="text-xs text-muted-foreground">
                      {fileStats.debtCount} loan{fileStats.debtCount === 1 ? "" : "s"} &amp; capital lease{fileStats.debtCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-muted border flex items-center justify-center flex-shrink-0">
                    <Calendar className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Current Portion</p>
                    <p className="text-lg font-bold tracking-tight">{formatCurrency(summary.totalCurrent)}</p>
                    <p className="text-xs text-muted-foreground">due within 12 months</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-muted border flex items-center justify-center flex-shrink-0">
                    <Wallet className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Long-Term Portion</p>
                    <p className="text-lg font-bold tracking-tight">{formatCurrency(summary.totalLongTerm)}</p>
                    <p className="text-xs text-muted-foreground">beyond 12 months</p>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 flex items-start gap-3">
                  <div className="h-9 w-9 rounded-lg bg-muted border flex items-center justify-center flex-shrink-0">
                    <Receipt className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Operating Lease Commitments</p>
                    <p className="text-lg font-bold tracking-tight">{formatCurrency(summary.operatingLeaseTotalCommitment)}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(summary.operatingLeaseMonthlyTotal)}/mo · {summary.operatingLeaseCount} lease{summary.operatingLeaseCount === 1 ? "" : "s"}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <Card
                className={
                  fileStats.fvFlagged + fileStats.maturingSoon > 0
                    ? "bg-rose-50/50 dark:bg-rose-950/20 border-rose-100 dark:border-rose-900/40"
                    : "bg-muted/40"
                }
              >
                <CardContent className="p-4 flex items-start gap-3">
                  <div
                    className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      fileStats.fvFlagged + fileStats.maturingSoon > 0
                        ? "bg-rose-100 dark:bg-rose-900/40"
                        : "bg-muted"
                    }`}
                  >
                    {fileStats.fvFlagged + fileStats.maturingSoon > 0 ? (
                      <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Needs Attention</p>
                    <p className="text-lg font-bold tracking-tight">
                      {fileStats.fvFlagged + fileStats.maturingSoon === 0
                        ? "All clear"
                        : fileStats.fvFlagged + fileStats.maturingSoon}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fileStats.fvFlagged + fileStats.maturingSoon === 0
                        ? "no flags or upcoming maturities"
                        : [
                            fileStats.fvFlagged > 0 ? `${fileStats.fvFlagged} FV flag${fileStats.fvFlagged === 1 ? "" : "s"}` : null,
                            fileStats.maturingSoon > 0 ? `${fileStats.maturingSoon} maturing ≤ 1 yr` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          <Tabs value={loanTab} onValueChange={setLoanTab}>
            <TabsList className="gap-1 p-1 bg-muted/60">
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="loans">Loans & Leases</TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>View and manage all loans and leases in this file</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="summary">Summary Tables</TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>Combined debt continuity and payment summary tables</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="presentation">Presentation &amp; Disclosure</TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>Financial statement presentation and note disclosure items</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <TabsTrigger value="review" className="gap-1.5">
                    Review
                    {diagnostics && diagnostics.totals.errors + diagnostics.totals.warnings > 0 && (
                      <span className={`inline-flex items-center justify-center rounded-full px-1.5 min-w-[18px] h-[18px] text-[10px] font-bold ${diagnostics.totals.errors > 0 ? "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300" : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"}`}>
                        {diagnostics.totals.errors + diagnostics.totals.warnings}
                      </span>
                    )}
                  </TabsTrigger>
                </TooltipTrigger>
                <TooltipContent>Diagnostic checklist of missing or incomplete information</TooltipContent>
              </Tooltip>
            </TabsList>

            <TabsContent value="review" className="space-y-6">
              {diagnostics && file && (
                <>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <ShieldCheck className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold tracking-tight">File Review</h2>
                        <p className="text-sm text-muted-foreground">
                          Automatic check for missing or incomplete information across this year-end file
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {diagnostics.totals.errors > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 px-2.5 py-1 font-medium text-red-700 dark:text-red-300">
                          <XCircle className="h-3.5 w-3.5" /> {diagnostics.totals.errors} missing
                        </span>
                      )}
                      {diagnostics.totals.warnings > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 px-2.5 py-1 font-medium text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3.5 w-3.5" /> {diagnostics.totals.warnings} incomplete
                        </span>
                      )}
                      {diagnostics.totals.errors === 0 && diagnostics.totals.warnings === 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Nothing outstanding
                        </span>
                      )}
                    </div>
                  </div>

                  <Card>
                    <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                      <div>
                        <CardTitle className="text-base">File Settings</CardTitle>
                        <CardDescription>Thresholds and setup for this year-end file</CardDescription>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          if (!file) return;
                          setEditFileName(file.name);
                          setEditFileYearEnd(file.fiscalYearEnd.split("T")[0]);
                          setEditTrivialThreshold(file.trivialThreshold ?? undefined);
                          setEditMateriality(file.materiality ?? undefined);
                          setEditOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit File
                      </Button>
                    </CardHeader>
                    <CardContent>
                      <FindingsList
                        findings={diagnostics.fileFindings}
                        dismissed={diagnostics.fileDismissed}
                        onDismiss={(id) => setFileDismissed(id, true)}
                        onRestore={(id) => setFileDismissed(id, false)}
                      />
                    </CardContent>
                  </Card>

                  {diagnostics.loans.map((ld) => {
                    const loan = loans?.find((l) => l.id === ld.loanId);
                    return (
                      <Card key={ld.loanId}>
                        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              {ld.loanName}
                              <span className="text-xs font-normal text-muted-foreground">{ld.kindLabel}</span>
                            </CardTitle>
                            <CardDescription>
                              {ld.findings.length === 0
                                ? ld.dismissed.length > 0
                                  ? "Complete (some checks dismissed)"
                                  : "Complete"
                                : `${ld.findings.length} item${ld.findings.length === 1 ? "" : "s"} to review`}
                            </CardDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            {loan && (
                              <Button variant="outline" size="sm" className="gap-2" onClick={() => openEditLoan(loan)}>
                                <Pencil className="h-3.5 w-3.5" />
                                Edit
                              </Button>
                            )}
                            <Link href={`/client/${clientId}/file/${fileId}/loan/${ld.loanId}`}>
                              <Button variant="ghost" size="sm" className="gap-2">
                                View
                                <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                              </Button>
                            </Link>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <FindingsList
                            findings={ld.findings}
                            dismissed={ld.dismissed}
                            onDismiss={(id) => setLoanDismissed(ld.loanId, id, true)}
                            onRestore={(id) => setLoanDismissed(ld.loanId, id, false)}
                          />
                        </CardContent>
                      </Card>
                    );
                  })}
                </>
              )}
            </TabsContent>

            <TabsContent value="loans" className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Landmark className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-display font-semibold">Loans & Leases</h2>
                    {loans && (
                      <div className="flex items-center gap-2 mt-1">
                        {(() => {
                          const op = loans.filter((l) => !l.isCapitalLease && Number(l.interestRate) === 0 && l.monthlyPayment != null).length;
                          const cap = loans.filter((l) => l.isCapitalLease).length;
                          const ln = loans.length - op - cap;
                          return (
                            <>
                              {ln > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-xs font-semibold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                                  {ln} Loan{ln !== 1 ? "s" : ""}
                                </span>
                              )}
                              {cap > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-xs font-semibold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                                  {cap} Capital
                                </span>
                              )}
                              {op > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2.5 py-0.5 text-xs font-semibold">
                                  <span className="w-1.5 h-1.5 rounded-full bg-primary"></span>
                                  {op} Operating
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button className="gap-2 shadow-sm hover:shadow-md transition-shadow">
                        <Plus className="h-4 w-4" />
                        Add Loan or Lease
                        <ChevronDown className="h-4 w-4 opacity-70" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-72">
                      <DropdownMenuItem
                        className="cursor-pointer items-start gap-3 py-2.5"
                        onClick={() => setImportOpen(true)}
                      >
                        <FileUp className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">Import from PDF</p>
                          <p className="text-xs text-muted-foreground">AI reads the agreement — works for loans and leases</p>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer items-start gap-3 py-2.5"
                        onClick={() => {
                          setEditingLoanId(null);
                          setForm(makeBlankLoanForm());
                          setPendingSourceDoc(null);
                          setCreateOpen(true);
                        }}
                      >
                        <Landmark className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">Add Loan</p>
                          <p className="text-xs text-muted-foreground">Enter loan terms directly</p>
                        </div>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer items-start gap-3 py-2.5"
                        onClick={() => {
                          setImportedAnswers(undefined);
                          setImportedLeaseMeta(null);
                          setImportedNotes(null);
                          setImportedEstimates(null);
                          setPendingSourceDoc(null);
                          setAssessmentOpen(true);
                        }}
                      >
                        <Receipt className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">Add Lease</p>
                          <p className="text-xs text-muted-foreground">Guided capital vs. operating classification (ASPE 3065)</p>
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          if (file?.fiscalYearEnd) {
                            const nextYear = addYears(parseISO(file.fiscalYearEnd), 1);
                            setNewYearEnd(format(nextYear, "yyyy-MM-dd"));
                          }
                          setRollForwardOpen(true);
                        }}
                      >
                        <CalendarPlus className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Roll forward to next fiscal year</TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {loans && loans.length === 0 && (
                <Card className="border-dashed border-2 border-muted bg-muted/30">
                  <CardContent className="py-8 text-center space-y-3">
                    <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center mx-auto">
                      <Calculator className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-base font-medium">No loans yet</p>
                      <p className="text-sm text-muted-foreground">
                        Add a loan to this year-end file.
                      </p>
                    </div>
                    <div className="flex gap-2 justify-center">
                      <Button
                        onClick={() => {
                          setEditingLoanId(null);
                          setForm(makeBlankLoanForm());
                          setPendingSourceDoc(null);
                          setCreateOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Loan
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setForm({
                            ...makeBlankLoanForm(),
                            isCapitalLease: true,
                            collateralType: "equipment",
                          });
                          setEditingLoanId(null);
                          setImportedAnswers(undefined);
                          setImportedLeaseMeta(null);
                          setImportedNotes(null);
                          setImportedEstimates(null);
                          setPendingSourceDoc(null);
                          setAssessmentOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Add Lease
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {loans && loans.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={loanSearch}
                      onChange={(e) => setLoanSearch(e.target.value)}
                      placeholder="Search loans & leases..."
                      className="h-9 w-[220px] md:w-[280px] pl-8 text-sm"
                    />
                  </div>
                  {maturedCount > 0 && (
                    <div className="inline-flex items-center rounded-lg bg-muted p-1 text-xs font-medium">
                      <button
                        type="button"
                        aria-pressed={!showMatured}
                        onClick={() => setShowMatured(false)}
                        className={`inline-flex items-center justify-center rounded-md px-2.5 py-1.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${!showMatured ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        Active ({(loans?.length ?? 0) - maturedCount})
                      </button>
                      <button
                        type="button"
                        aria-pressed={showMatured}
                        onClick={() => setShowMatured(true)}
                        className={`inline-flex items-center justify-center rounded-md px-2.5 py-1.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${showMatured ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        All ({loans?.length ?? 0})
                      </button>
                    </div>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <Select value={loanSort} onValueChange={setLoanSort}>
                      <SelectTrigger className="h-9 w-[190px] text-xs">
                        <SelectValue placeholder="Sort" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default order</SelectItem>
                        <SelectItem value="name-asc">Name (A to Z)</SelectItem>
                        <SelectItem value="name-desc">Name (Z to A)</SelectItem>
                        <SelectItem value="outstanding-desc">Outstanding (high to low)</SelectItem>
                        <SelectItem value="outstanding-asc">Outstanding (low to high)</SelectItem>
                        <SelectItem value="maturity-asc">Maturity (earliest first)</SelectItem>
                        <SelectItem value="maturity-desc">Maturity (latest first)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="inline-flex items-center rounded-lg bg-muted p-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Card view"
                            aria-pressed={loanView === "cards"}
                            onClick={() => setLoanView("cards")}
                            className={`inline-flex items-center justify-center rounded-md px-2.5 py-1.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${loanView === "cards" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            <LayoutGrid className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Card view</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Table view"
                            aria-pressed={loanView === "table"}
                            onClick={() => setLoanView("table")}
                            className={`inline-flex items-center justify-center rounded-md px-2.5 py-1.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${loanView === "table" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                          >
                            <TableIcon className="h-4 w-4" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Table view</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              )}

              {(() => {
                const searchQ = loanSearch.trim().toLowerCase();
                const matchesSearch = (l: any) =>
                  !searchQ ||
                  (l.name ?? "").toLowerCase().includes(searchQ) ||
                  (l.lender ?? "").toLowerCase().includes(searchQ) ||
                  (l.description ?? "").toLowerCase().includes(searchQ);
                const visibleLoans = (showMatured ? loans ?? [] : (loans ?? []).filter((l) => !isMaturedLoan(l))).filter(matchesSearch);

                const outstandingOf = (loan: any): number => {
                  const isOperating = !loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null;
                  if (isOperating) return 0;
                  const result = calculateBookedSchedule(loan);
                  const reportYearEnd = parseISO(loan.fiscalYearEnd ?? file?.fiscalYearEnd ?? format(new Date(), "yyyy-MM-dd"));
                  return result.schedule.filter((row) => !isAfter(row.date, reportYearEnd)).slice(-1)[0]?.balance ?? (Number(loan.principal) - Number(loan.downPayment ?? 0));
                };
                const maturityOf = (loan: any): number => {
                  if (!loan.startDate) return Number.MAX_SAFE_INTEGER;
                  const maturity = computeMaturityDate(loan.startDate, loan.termYears, loan.termMonths);
                  return isNaN(maturity.getTime()) ? Number.MAX_SAFE_INTEGER : maturity.getTime();
                };
                const sortItems = (items: any[]): any[] => {
                  if (loanSort === "default") return items;
                  const sorted = [...items];
                  switch (loanSort) {
                    case "name-asc": sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })); break;
                    case "name-desc": sorted.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" })); break;
                    case "outstanding-desc": sorted.sort((a, b) => outstandingOf(b) - outstandingOf(a)); break;
                    case "outstanding-asc": sorted.sort((a, b) => outstandingOf(a) - outstandingOf(b)); break;
                    case "maturity-asc": sorted.sort((a, b) => maturityOf(a) - maturityOf(b)); break;
                    case "maturity-desc": sorted.sort((a, b) => maturityOf(b) - maturityOf(a)); break;
                  }
                  return sorted;
                };

                const regularLoans = sortItems(visibleLoans.filter((l) => {
                  const isOperating = !l.isCapitalLease && Number(l.interestRate) === 0 && l.monthlyPayment != null;
                  return !l.isCapitalLease && !isOperating;
                }));
                const capitalLeases = sortItems(visibleLoans.filter((l) => l.isCapitalLease));
                const operatingLeases = sortItems(visibleLoans.filter((l) => !l.isCapitalLease && Number(l.interestRate) === 0 && l.monthlyPayment != null));

                const renderCard = (loan: any) => {
                  const isOperatingLease = !loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null;
                  const cardBorderClass = loan.isCapitalLease ? "card-capital-lease" : isOperatingLease ? "card-operating-lease" : "card-loan";
                  return (
                  <Card key={loan.id} className={`group rounded-2xl overflow-hidden hover:shadow-xl hover:shadow-gray-200/50 hover:border-primary/30 transition-all duration-300 shadow-sm flex flex-col p-0 gap-0 ${cardBorderClass}`}>
                    <CardHeader className="p-6 pb-0">
                      <div className="flex items-start justify-between">
                        <div>
                          <CardTitle className="text-lg font-display leading-tight">{loan.name}</CardTitle>
                          <CardDescription className="mt-1">
                            {(() => {
                              if (loan.isCapitalLease) return `Capital Lease — ${formatCurrency(Number(loan.principal))}`;
                              if (isOperatingLease) return `Operating Lease — ${formatCurrency(Number(loan.monthlyPayment ?? 0))}/mo`;
                              return `Loan — ${formatCurrency(Number(loan.principal))}`;
                            })()}
                          </CardDescription>
                          {(() => {
                            const statusBadges = renderStatusBadges(loan);
                            if (!loan.fvDecision && statusBadges.length === 0) return null;
                            return (
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              {loan.fvDecision === "use_fv" && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">FV Rate Applied</span>
                              )}
                              {loan.fvDecision === "trivial" && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">FV Trivial</span>
                              )}
                              {loan.fvDecision === "immaterial" && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-200 px-1.5 py-0.5 rounded">FV Immaterial (UA MIS)</span>
                              )}
                              {statusBadges}
                            </div>
                            );
                          })()}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-primary"
                                onClick={() => openEditLoan(loan)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit loan details</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setDeleteTarget(loan.id);
                              setDeleteOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete loan</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 pt-4 pb-5 flex-1">
                      {(() => {
                        if (isOperatingLease) {
                          const monthly = Number(loan.monthlyPayment ?? 0);
                          const term = loan.termMonths ?? 0;
                          const total = monthly * term;
                          return (
                            <div className="text-sm space-y-1">
                              <div className="flex justify-between"><span className="text-muted-foreground">Monthly Payment</span><span className="font-medium">{formatCurrency(monthly)}</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Term</span><span className="font-medium">{term} months</span></div>
                              <div className="flex justify-between"><span className="text-muted-foreground">Total Commitment</span><span className="font-medium">{formatCurrency(total)}</span></div>
                            </div>
                          );
                        }
                        // Loan or capital lease — compute the booked schedule. When
                        // fair value is adopted the contractual payment is held fixed.
                        const effectiveRate = loan.fvDecision === "use_fv" && loan.fvRate != null ? Number(loan.fvRate) : Number(loan.interestRate);
                        const result = calculateBookedSchedule(loan);
                        const reportYearEnd = parseISO(loan.fiscalYearEnd ?? file?.fiscalYearEnd ?? format(new Date(), "yyyy-MM-dd"));
                        const currentPeriodEnd = new Date(reportYearEnd);
                        currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
                        const balanceAtYearEnd = result.schedule.filter((row) => !isAfter(row.date, reportYearEnd)).slice(-1)[0]?.balance ?? (Number(loan.principal) - Number(loan.downPayment ?? 0));
                        const scheduledCurrent = result.schedule
                          .filter((row) => isAfter(row.date, reportYearEnd) && !isAfter(row.date, currentPeriodEnd))
                          .reduce((sum, row) => sum + row.principal, 0);
                        const scheduledLongTerm = Math.max(0, balanceAtYearEnd - scheduledCurrent);
                        const hasViolation = !!loan.covenantViolation;
                        const currentPortion = hasViolation ? balanceAtYearEnd : scheduledCurrent;
                        const longTermPortion = hasViolation ? 0 : scheduledLongTerm;
                        const regularPayment = result.schedule.find((row) => row.principal > 0 && !row.isInterestOnly)?.payment ?? result.monthlyPayment;
                        const termLabel = loan.termMonths ? `${loan.termMonths} months` : `${loan.termYears} yrs`;
                        return (
                          <div className="text-sm space-y-1">
                            <div className="flex justify-between"><span className="text-muted-foreground">Original</span><span className="font-medium">{formatCurrency(Number(loan.principal))}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Outstanding</span><span className="font-medium">{formatCurrency(balanceAtYearEnd)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Current</span><span className="font-medium">{formatCurrency(currentPortion)}</span></div>
                            {hasViolation && (
                              <>
                                <div className="flex justify-between pl-3"><span className="text-muted-foreground text-xs">Scheduled ≤ 1 yr</span><span className="text-xs">{formatCurrency(scheduledCurrent)}</span></div>
                                <div className="flex justify-between pl-3"><span className="text-muted-foreground text-xs">Scheduled &gt; 1 yr (callable)</span><span className="text-xs">{formatCurrency(scheduledLongTerm)}</span></div>
                              </>
                            )}
                            <div className="flex justify-between"><span className="text-muted-foreground">Long Term</span><span className="font-medium">{formatCurrency(longTermPortion)}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Rate</span><span className="font-medium">{effectiveRate.toFixed(2)}% {loan.fvDecision === "use_fv" && <span className="text-[10px] text-amber-600 font-semibold ml-1">(FV)</span>}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Term</span><span className="font-medium">{termLabel}</span></div>
                            <div className="flex justify-between"><span className="text-muted-foreground">Payment</span><span className="font-medium">{formatCurrency(regularPayment)}</span></div>
                          </div>
                        );
                      })()}
                    </CardContent>
                    <Link href={`/client/${clientId}/file/${fileId}/loan/${loan.id}`} className="cursor-pointer block px-6 py-4 bg-muted/30 border-t flex items-center justify-between group-hover:bg-primary/5 transition-colors">
                      <div className="flex items-center gap-2">
                        <Calculator className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                        <span className="text-sm font-semibold">View Schedule</span>
                      </div>
                      <span className="w-8 h-8 rounded-full bg-background border flex items-center justify-center text-muted-foreground group-hover:bg-primary group-hover:border-primary group-hover:text-primary-foreground transition-all shadow-sm">
                        <ArrowRight className="w-4 h-4" />
                      </span>
                    </Link>
                  </Card>
                  );
                };

                const getDebtMetrics = (loan: any) => {
                  const effectiveRate = loan.fvDecision === "use_fv" && loan.fvRate != null ? Number(loan.fvRate) : Number(loan.interestRate);
                  const result = calculateBookedSchedule(loan);
                  const reportYearEnd = parseISO(loan.fiscalYearEnd ?? file?.fiscalYearEnd ?? format(new Date(), "yyyy-MM-dd"));
                  const currentPeriodEnd = new Date(reportYearEnd);
                  currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
                  const balanceAtYearEnd = result.schedule.filter((row) => !isAfter(row.date, reportYearEnd)).slice(-1)[0]?.balance ?? (Number(loan.principal) - Number(loan.downPayment ?? 0));
                  const currentPortion = result.schedule
                    .filter((row) => isAfter(row.date, reportYearEnd) && !isAfter(row.date, currentPeriodEnd))
                    .reduce((sum, row) => sum + row.principal, 0);
                  const scheduledLongTerm = Math.max(0, balanceAtYearEnd - currentPortion);
                  const hasViolation = !!loan.covenantViolation;
                  const regularPayment = result.schedule.find((row) => row.principal > 0 && !row.isInterestOnly)?.payment ?? result.monthlyPayment;
                  const termLabel = loan.termMonths ? `${loan.termMonths} months` : `${loan.termYears} yrs`;
                  return {
                    effectiveRate,
                    balanceAtYearEnd,
                    currentPortion: hasViolation ? balanceAtYearEnd : currentPortion,
                    longTermPortion: hasViolation ? 0 : scheduledLongTerm,
                    regularPayment,
                    termLabel,
                  };
                };

                const rowActions = (loan: any) => (
                  <div className="flex items-center justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Link href={`/client/${clientId}/file/${fileId}/loan/${loan.id}`}>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                            <Calculator className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TooltipTrigger>
                      <TooltipContent>View schedule</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => openEditLoan(loan)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit loan details</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => {
                            setDeleteTarget(loan.id);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete loan</TooltipContent>
                    </Tooltip>
                  </div>
                );

                const fvBadge = (loan: any) => {
                  if (!loan.fvDecision) return null;
                  if (loan.fvDecision === "use_fv") return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded whitespace-nowrap">FV Rate</span>;
                  if (loan.fvDecision === "trivial") return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded whitespace-nowrap">FV Trivial</span>;
                  return <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-200 px-1.5 py-0.5 rounded whitespace-nowrap">FV Immaterial</span>;
                };

                const renderDebtTable = (items: any[]) => (
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-muted-foreground">
                          <th className="text-left font-medium px-4 py-2.5">Name</th>
                          <th className="text-right font-medium px-4 py-2.5">Original</th>
                          <th className="text-right font-medium px-4 py-2.5">Outstanding</th>
                          <th className="text-right font-medium px-4 py-2.5">Current</th>
                          <th className="text-right font-medium px-4 py-2.5">Long Term</th>
                          <th className="text-right font-medium px-4 py-2.5">Rate</th>
                          <th className="text-right font-medium px-4 py-2.5">Term</th>
                          <th className="text-right font-medium px-4 py-2.5">Payment</th>
                          <th className="text-right font-medium px-4 py-2.5 w-28"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((loan) => {
                          const m = getDebtMetrics(loan);
                          return (
                            <tr key={loan.id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Link href={`/client/${clientId}/file/${fileId}/loan/${loan.id}`} className="font-medium hover:text-primary hover:underline cursor-pointer">
                                    {loan.name}
                                  </Link>
                                  {fvBadge(loan)}
                                  {renderStatusBadges(loan)}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(Number(loan.principal))}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(m.balanceAtYearEnd)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(m.currentPortion)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(m.longTermPortion)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{m.effectiveRate.toFixed(2)}%{loan.fvDecision === "use_fv" && <span className="text-[10px] text-amber-600 font-semibold ml-1">(FV)</span>}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{m.termLabel}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(m.regularPayment)}</td>
                              <td className="px-4 py-2.5">{rowActions(loan)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );

                const renderOperatingTable = (items: any[]) => (
                  <div className="rounded-lg border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-muted-foreground">
                          <th className="text-left font-medium px-4 py-2.5">Name</th>
                          <th className="text-right font-medium px-4 py-2.5">Monthly Payment</th>
                          <th className="text-right font-medium px-4 py-2.5">Term</th>
                          <th className="text-right font-medium px-4 py-2.5">Total Commitment</th>
                          <th className="text-right font-medium px-4 py-2.5 w-28"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((loan) => {
                          const monthly = Number(loan.monthlyPayment ?? 0);
                          const term = loan.termMonths ?? 0;
                          return (
                            <tr key={loan.id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                              <td className="px-4 py-2.5">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Link href={`/client/${clientId}/file/${fileId}/loan/${loan.id}`} className="font-medium hover:text-primary hover:underline cursor-pointer">
                                    {loan.name}
                                  </Link>
                                  {renderStatusBadges(loan)}
                                </div>
                              </td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{formatCurrency(monthly)}</td>
                              <td className="px-4 py-2.5 text-right tabular-nums">{term} months</td>
                              <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatCurrency(monthly * term)}</td>
                              <td className="px-4 py-2.5">{rowActions(loan)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );

                const renderGroup = (items: any[], dotClass: string, label: string, table: (items: any[]) => React.ReactNode) =>
                  items.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-lg font-display font-semibold flex items-center gap-2">
                        <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`}></span>
                        {label}
                        <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
                      </h3>
                      {loanView === "table" ? (
                        table(items)
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {items.map(renderCard)}
                        </div>
                      )}
                    </div>
                  );

                return (
                  <div className="space-y-8">
                    {searchQ && visibleLoans.length === 0 && (loans?.length ?? 0) > 0 && (
                      <Card className="border-dashed border-2 border-muted bg-muted/30">
                        <CardContent className="py-8 text-center space-y-2">
                          <Search className="h-8 w-8 text-muted-foreground mx-auto" />
                          <p className="text-sm text-muted-foreground">
                            No loans or leases match "{loanSearch}".
                          </p>
                        </CardContent>
                      </Card>
                    )}
                    {renderGroup(regularLoans, "bg-primary", "Loans", renderDebtTable)}
                    {renderGroup(capitalLeases, "bg-primary", "Capital Leases", renderDebtTable)}
                    {renderGroup(operatingLeases, "bg-primary", "Operating Leases", renderOperatingTable)}
                  </div>
                );
              })()}
            </TabsContent>

            <TabsContent value="summary" className="space-y-8">
              {(() => {
                const regularLoans = loans?.filter((l) => {
                  const isOperating = !l.isCapitalLease && Number(l.interestRate) === 0 && l.monthlyPayment != null;
                  return !l.isCapitalLease && !isOperating;
                }) ?? [];
                const capitalLeases = loans?.filter((l) => l.isCapitalLease) ?? [];

                // Pre-compute individual schedules
                const loanSchedules = regularLoans.map((item) => ({
                  name: item.name,
                  schedule: calculateBookedSchedule(item).schedule,
                }));
                const leaseSchedules = capitalLeases.map((item) => ({
                  name: item.name,
                  schedule: calculateBookedSchedule(item).schedule,
                }));

                const maxLoanPeriods = Math.max(0, ...loanSchedules.map((s) => s.schedule.length));
                const maxLeasePeriods = Math.max(0, ...leaseSchedules.map((s) => s.schedule.length));

                const buildCombinedRows = (schedules: { name: string; schedule: any[] }[], maxPeriods: number) => {
                  const rows: { period: number; date: Date | null; totalPayment: number; totalPrincipal: number; totalInterest: number; balance: number; details: { name: string; payment: number; principal: number; interest: number; balance: number }[] }[] = [];
                  for (let i = 0; i < maxPeriods; i++) {
                    const period = i + 1;
                    const details = schedules.map((s) => {
                      const row = s.schedule[i];
                      if (!row) return { name: s.name, payment: 0, principal: 0, interest: 0, balance: 0 };
                      return { name: s.name, payment: row.payment, principal: row.principal, interest: row.interest, balance: row.balance };
                    });
                    const totalPayment = details.reduce((sum, d) => sum + d.payment, 0);
                    const totalPrincipal = details.reduce((sum, d) => sum + d.principal, 0);
                    const totalInterest = details.reduce((sum, d) => sum + d.interest, 0);
                    const balance = details.reduce((sum, d) => sum + d.balance, 0);
                    const firstDate = schedules.map((s) => s.schedule[i]?.date).find((d) => d != null) ?? null;
                    rows.push({ period, date: firstDate, totalPayment, totalPrincipal, totalInterest, balance, details });
                  }
                  return rows;
                };

                const loanRows = buildCombinedRows(loanSchedules, maxLoanPeriods);
                const leaseRows = buildCombinedRows(leaseSchedules, maxLeasePeriods);

                // Highlight the last period in each fiscal year, matching the
                // individual loan schedule tables.
                const fyeDate = file?.fiscalYearEnd ? parseISO(file.fiscalYearEnd) : null;
                const fiscalYearOf = (date: Date) => {
                  if (!fyeDate) return date.getFullYear();
                  let fy = date.getFullYear();
                  if (isAfter(date, new Date(fy, fyeDate.getUTCMonth(), fyeDate.getUTCDate()))) fy++;
                  return fy;
                };
                const isFyeRow = (rows: { date: Date | null }[], i: number) => {
                  const d = rows[i]?.date;
                  if (!d || !fyeDate) return false;
                  const next = rows[i + 1]?.date;
                  if (!next) return true;
                  return fiscalYearOf(next) !== fiscalYearOf(d);
                };
                const fyeBadge = (
                  <span className="text-[10px] font-semibold uppercase tracking-wide rounded bg-primary/15 text-primary px-1.5 py-0.5 whitespace-nowrap">
                    FYE
                  </span>
                );

                // Per-loan summary metrics for the "By Loan" view.
                const getSummaryMetrics = (loan: any) => {
                  const effectiveRate = loan.fvDecision === "use_fv" && loan.fvRate != null ? Number(loan.fvRate) : Number(loan.interestRate);
                  const result = calculateBookedSchedule(loan);
                  const reportYearEnd = parseISO(loan.fiscalYearEnd ?? file?.fiscalYearEnd ?? format(new Date(), "yyyy-MM-dd"));
                  const priorYearEnd = new Date(reportYearEnd);
                  priorYearEnd.setFullYear(priorYearEnd.getFullYear() - 1);
                  const nextYearEnd = new Date(reportYearEnd);
                  nextYearEnd.setFullYear(nextYearEnd.getFullYear() + 1);
                  const outstanding = result.schedule.filter((row) => !isAfter(row.date, reportYearEnd)).slice(-1)[0]?.balance ?? (Number(loan.principal) - Number(loan.downPayment ?? 0));
                  const currentPortion = result.schedule
                    .filter((row) => isAfter(row.date, reportYearEnd) && !isAfter(row.date, nextYearEnd))
                    .reduce((sum, row) => sum + row.principal, 0);
                  const scheduledLongTerm = Math.max(0, outstanding - currentPortion);
                  const hasViolation = !!loan.covenantViolation;
                  const fyRows = result.schedule.filter((row) => isAfter(row.date, priorYearEnd) && !isAfter(row.date, reportYearEnd));
                  const fyInterest = fyRows.reduce((sum, row) => sum + row.interest, 0);
                  const fyPrincipal = fyRows.reduce((sum, row) => sum + row.principal, 0);
                  return {
                    effectiveRate,
                    outstanding,
                    currentPortion: hasViolation ? outstanding : currentPortion,
                    longTermPortion: hasViolation ? 0 : scheduledLongTerm,
                    fyInterest,
                    fyPrincipal,
                  };
                };

                const renderByLoanTable = (items: any[], title: string, description: string) => {
                  const metrics = items.map((loan) => ({ loan, m: getSummaryMetrics(loan) }));
                  const totals = metrics.reduce(
                    (acc, { loan, m }) => ({
                      original: acc.original + Number(loan.principal),
                      outstanding: acc.outstanding + m.outstanding,
                      current: acc.current + m.currentPortion,
                      longTerm: acc.longTerm + m.longTermPortion,
                      interest: acc.interest + m.fyInterest,
                      principal: acc.principal + m.fyPrincipal,
                    }),
                    { original: 0, outstanding: 0, current: 0, longTerm: 0, interest: 0, principal: 0 },
                  );
                  return (
                    <Card>
                      <CardHeader>
                        <CardTitle className="font-display">{title}</CardTitle>
                        <CardDescription>{description}</CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                              <tr>
                                <th className="text-left p-2 font-medium">Name</th>
                                <th className="text-right p-2 font-medium">Original</th>
                                <th className="text-right p-2 font-medium">Outstanding</th>
                                <th className="text-right p-2 font-medium">Current</th>
                                <th className="text-right p-2 font-medium">Long Term</th>
                                <th className="text-right p-2 font-medium">Rate</th>
                                <th className="text-right p-2 font-medium">Interest (FY)</th>
                                <th className="text-right p-2 font-medium">Principal Paid (FY)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {metrics.map(({ loan, m }, i) => (
                                <tr key={loan.id} className={`border-b hover:bg-muted/30 ${i % 2 === 1 ? "bg-muted/20" : ""}`}>
                                  <td className="p-2">
                                    <Link href={`/client/${clientId}/file/${fileId}/loan/${loan.id}`} className="font-medium hover:text-primary hover:underline cursor-pointer">
                                      {loan.name}
                                    </Link>
                                  </td>
                                  <td className="p-2 text-right tabular-nums">{formatCurrency(Number(loan.principal))}</td>
                                  <td className="p-2 text-right tabular-nums font-medium">{formatCurrency(m.outstanding)}</td>
                                  <td className="p-2 text-right tabular-nums">{formatCurrency(m.currentPortion)}</td>
                                  <td className="p-2 text-right tabular-nums">{formatCurrency(m.longTermPortion)}</td>
                                  <td className="p-2 text-right tabular-nums">{m.effectiveRate.toFixed(2)}%{loan.fvDecision === "use_fv" && <span className="text-[10px] text-amber-600 font-semibold ml-1">(FV)</span>}</td>
                                  <td className="p-2 text-right tabular-nums">{formatCurrency(m.fyInterest)}</td>
                                  <td className="p-2 text-right tabular-nums">{formatCurrency(m.fyPrincipal)}</td>
                                </tr>
                              ))}
                              <tr className="bg-muted/50 font-bold border-t-2">
                                <td className="p-2 font-bold">Total</td>
                                <td className="p-2 text-right font-bold tabular-nums">{formatCurrency(totals.original)}</td>
                                <td className="p-2 text-right font-bold tabular-nums">{formatCurrency(totals.outstanding)}</td>
                                <td className="p-2 text-right font-bold tabular-nums">{formatCurrency(totals.current)}</td>
                                <td className="p-2 text-right font-bold tabular-nums">{formatCurrency(totals.longTerm)}</td>
                                <td className="p-2"></td>
                                <td className="p-2 text-right font-bold tabular-nums">{formatCurrency(totals.interest)}</td>
                                <td className="p-2 text-right font-bold tabular-nums">{formatCurrency(totals.principal)}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  );
                };

                const viewToggle = (
                  <div className="flex items-center gap-1 rounded-lg bg-muted p-1 text-sm w-fit">
                    <button
                      type="button"
                      aria-pressed={summaryView === "combined"}
                      onClick={() => setSummaryView("combined")}
                      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${summaryView === "combined" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      Combined Schedule
                    </button>
                    <button
                      type="button"
                      aria-pressed={summaryView === "byloan"}
                      onClick={() => setSummaryView("byloan")}
                      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${summaryView === "byloan" ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      By Loan
                    </button>
                  </div>
                );

                if (summaryView === "byloan") {
                  return (
                    <div className="space-y-8">
                      {viewToggle}
                      {regularLoans.length > 0 && renderByLoanTable(regularLoans, "Loan Summary", `${regularLoans.length} loan${regularLoans.length !== 1 ? "s" : ""} — balances and current-year activity as at ${file?.fiscalYearEnd ? format(parseISO(file.fiscalYearEnd), "MMMM d, yyyy") : "year end"}`)}
                      {capitalLeases.length > 0 && renderByLoanTable(capitalLeases, "Capital Lease Summary", `${capitalLeases.length} capital lease${capitalLeases.length !== 1 ? "s" : ""} — balances and current-year activity as at ${file?.fiscalYearEnd ? format(parseISO(file.fiscalYearEnd), "MMMM d, yyyy") : "year end"}`)}
                      {regularLoans.length === 0 && capitalLeases.length === 0 && (
                        <div className="text-center py-12 text-muted-foreground">
                          No loans or capital leases to summarize.
                        </div>
                      )}
                    </div>
                  );
                }

                return (
                  <div className="space-y-8">
                    {viewToggle}
                    {loanRows.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="font-display">Combined Loan Schedule</CardTitle>
                          <CardDescription>{regularLoans.length} loan{regularLoans.length !== 1 ? "s" : ""} aggregated by period</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="max-h-[600px] overflow-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50 sticky top-0">
                                <tr>
                                  <th className="text-left p-2 font-medium">Period</th>
                                  <th className="text-left p-2 font-medium">Date</th>
                                  <th className="text-right p-2 font-medium">Payment</th>
                                  <th className="text-right p-2 font-medium">Principal</th>
                                  <th className="text-right p-2 font-medium">Interest</th>
                                  <th className="text-right p-2 font-medium">Balance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {loanRows.map((row, i) => (
                                  <tr key={row.period} className={`border-b hover:bg-muted/30 ${isFyeRow(loanRows, i) ? "bg-primary/10 font-semibold border-b-2 border-primary/30" : i % 2 === 1 ? "bg-muted/20" : ""}`}>
                                    <td className="p-2">{row.period}</td>
                                    <td className="p-2">
                                      <div className="flex items-center gap-2">
                                        <span>{row.date ? format(row.date, "MMM d, yyyy") : "-"}</span>
                                        {isFyeRow(loanRows, i) && fyeBadge}
                                      </div>
                                    </td>
                                    <td className="p-2 text-right">{formatCurrency(row.totalPayment)}</td>
                                    <td className="p-2 text-right">{formatCurrency(row.totalPrincipal)}</td>
                                    <td className="p-2 text-right">{formatCurrency(row.totalInterest)}</td>
                                    <td className="p-2 text-right font-semibold">{formatCurrency(row.balance)}</td>
                                  </tr>
                                ))}
                                <tr className="bg-muted/50 font-bold border-t-2">
                                  <td className="p-2 font-bold">Total</td>
                                  <td className="p-2">-</td>
                                  <td className="p-2 text-right font-bold">{formatCurrency(loanRows.reduce((s, r) => s + r.totalPayment, 0))}</td>
                                  <td className="p-2 text-right font-bold">{formatCurrency(loanRows.reduce((s, r) => s + r.totalPrincipal, 0))}</td>
                                  <td className="p-2 text-right font-bold">{formatCurrency(loanRows.reduce((s, r) => s + r.totalInterest, 0))}</td>
                                  <td className="p-2 text-right">-</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {leaseRows.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="font-display">Combined Capital Lease Schedule</CardTitle>
                          <CardDescription>{capitalLeases.length} capital lease{capitalLeases.length !== 1 ? "s" : ""} aggregated by period</CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="max-h-[600px] overflow-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-muted/50 sticky top-0">
                                <tr>
                                  <th className="text-left p-2 font-medium">Period</th>
                                  <th className="text-left p-2 font-medium">Date</th>
                                  <th className="text-right p-2 font-medium">Payment</th>
                                  <th className="text-right p-2 font-medium">Principal</th>
                                  <th className="text-right p-2 font-medium">Interest</th>
                                  <th className="text-right p-2 font-medium">Balance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {leaseRows.map((row, i) => (
                                  <tr key={row.period} className={`border-b hover:bg-muted/30 ${isFyeRow(leaseRows, i) ? "bg-primary/10 font-semibold border-b-2 border-primary/30" : i % 2 === 1 ? "bg-muted/20" : ""}`}>
                                    <td className="p-2">{row.period}</td>
                                    <td className="p-2">
                                      <div className="flex items-center gap-2">
                                        <span>{row.date ? format(row.date, "MMM d, yyyy") : "-"}</span>
                                        {isFyeRow(leaseRows, i) && fyeBadge}
                                      </div>
                                    </td>
                                    <td className="p-2 text-right">{formatCurrency(row.totalPayment)}</td>
                                    <td className="p-2 text-right">{formatCurrency(row.totalPrincipal)}</td>
                                    <td className="p-2 text-right">{formatCurrency(row.totalInterest)}</td>
                                    <td className="p-2 text-right font-semibold">{formatCurrency(row.balance)}</td>
                                  </tr>
                                ))}
                                <tr className="bg-muted/50 font-bold border-t-2">
                                  <td className="p-2 font-bold">Total</td>
                                  <td className="p-2">-</td>
                                  <td className="p-2 text-right font-bold">{formatCurrency(leaseRows.reduce((s, r) => s + r.totalPayment, 0))}</td>
                                  <td className="p-2 text-right font-bold">{formatCurrency(leaseRows.reduce((s, r) => s + r.totalPrincipal, 0))}</td>
                                  <td className="p-2 text-right font-bold">{formatCurrency(leaseRows.reduce((s, r) => s + r.totalInterest, 0))}</td>
                                  <td className="p-2 text-right">-</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </CardContent>
                      </Card>
                    )}
                    {loanRows.length === 0 && leaseRows.length === 0 && (
                      <div className="text-center py-12 text-muted-foreground">
                        No loans or capital leases to summarize.
                      </div>
                    )}
                  </div>
                );
              })()}
            </TabsContent>

            <TabsContent value="presentation" className="space-y-6">
              {summary && (
                <>
                  {/* STATEMENT HEADER */}
                  <div className="rounded-xl border border-border/60 bg-card px-8 py-7 shadow-sm text-center">
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{client?.name ?? "Company"}</p>
                    <h1 className="mt-1.5 font-display text-2xl font-semibold">Financial Statement Extracts</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                      For the year ended {file?.fiscalYearEnd ? format(parseISO(file.fiscalYearEnd), "MMMM d, yyyy") : ""}
                    </p>
                    <p className="mx-auto mt-3 max-w-xl text-xs italic text-muted-foreground">
                      Relevant extracts prepared for debt and lease disclosures. All figures are expressed in Canadian dollars unless otherwise noted.
                    </p>
                  </div>

                  {/* COMPARATIVE FIGURES (roll-forward files only) */}
                  {priorSummary && priorFile?.fiscalYearEnd && (() => {
                    const fmtFy = (d: string) => format(parseISO(d), "MMM d, yyyy");
                    const rows: { label: string; current: number; prior: number; section?: string }[] = [
                      { section: "Balance Sheet", label: "Current portion of long-term debt", current: summary.loanCurrent, prior: priorSummary.loanCurrent },
                      { label: "Long-term debt", current: summary.loanLongTerm, prior: priorSummary.loanLongTerm },
                      { label: "Current portion of obligations under capital lease", current: summary.leaseCurrent, prior: priorSummary.leaseCurrent },
                      { label: "Obligations under capital lease — long-term", current: summary.leaseLongTerm, prior: priorSummary.leaseLongTerm },
                      { label: "Total debt and lease obligations", current: summary.totalDebt, prior: priorSummary.totalDebt },
                      { section: "Income Statement", label: "Interest expense", current: summary.totalInterestExpense, prior: priorSummary.totalInterestExpense },
                      { label: "Rent expense (straight-line)", current: summary.totalStraightLineRentExpense, prior: priorSummary.totalStraightLineRentExpense },
                    ].filter((r) => r.current !== 0 || r.prior !== 0);
                    if (rows.length === 0) return null;
                    return (
                      <div className="rounded-xl border border-border/60 bg-card p-6 md:p-8 shadow-sm space-y-4 tabular-nums">
                        <div className="border-b pb-3">
                          <h2 className="text-lg font-display font-semibold">Comparative Figures</h2>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Prior-year figures come from the {fmtFy(priorFile.fiscalYearEnd)} year-end file this file was rolled forward from. ASPE financial statements present the prior year beside the current year.
                          </p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-xs text-muted-foreground">
                                <th className="text-left py-2 font-medium"></th>
                                <th className="text-right py-2 font-medium whitespace-nowrap">{file?.fiscalYearEnd ? fmtFy(file.fiscalYearEnd) : "Current year"}</th>
                                <th className="text-right py-2 font-medium whitespace-nowrap">{fmtFy(priorFile.fiscalYearEnd)}</th>
                                <th className="text-right py-2 font-medium whitespace-nowrap">Change</th>
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <Fragment key={r.label}>
                                  {r.section && (
                                    <tr>
                                      <td colSpan={4} className="pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{r.section}</td>
                                    </tr>
                                  )}
                                  <tr className="border-t border-border/50">
                                    <td className="py-2 pr-4">{r.label}</td>
                                    <td className="py-2 text-right font-semibold">{formatCurrency(r.current)}</td>
                                    <td className="py-2 text-right">{formatCurrency(r.prior)}</td>
                                    <td className={`py-2 text-right text-xs ${r.current - r.prior > 0 ? "text-rose-700" : r.current - r.prior < 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                                      {r.current - r.prior === 0 ? "—" : `${r.current - r.prior > 0 ? "+" : "−"}${formatCurrency(Math.abs(r.current - r.prior))}`}
                                    </td>
                                  </tr>
                                </Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {/* 1. BALANCE SHEET */}
                  <div className="rounded-xl border border-border/60 bg-card p-6 md:p-8 shadow-sm space-y-4 tabular-nums">
                    <h2 className="text-lg font-display font-semibold border-b pb-3">Balance Sheet — Relevant Line Items</h2>
                    <div className="overflow-hidden text-sm">
                      {/* Current Assets */}
                      {(summary.deferredRentAsset > 0) && (
                        <>
                          <div className="px-1 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current Assets</div>
                          <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                            <span>Deferred rent (asset)</span>
                            <span className="font-semibold">{formatCurrency(summary.deferredRentAsset)}</span>
                          </div>
                        </>
                      )}
                      {/* Non-current Assets */}
                      {/* Current Liabilities */}
                      <div className="px-1 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current Liabilities</div>
                      {summary.loanCurrent > 0 && (() => {
                        const loanCallable = summary.loans.reduce((s, l) => s + l.scheduledBeyondOneYear, 0);
                        const loanWithin = summary.loans.reduce((s, l) => s + l.scheduledWithinOneYear, 0);
                        return (
                          <>
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Current portion of long-term debt</span>
                              <span className="font-semibold">{formatCurrency(summary.loanCurrent)}</span>
                            </div>
                            {loanCallable > 0 && (
                              <>
                                <div className="flex justify-between px-1 py-1 pl-6 text-xs text-muted-foreground">
                                  <span>Scheduled repayments due within one year</span>
                                  <span>{formatCurrency(loanWithin)}</span>
                                </div>
                                <div className="flex justify-between px-1 py-1 pl-6 text-xs text-muted-foreground">
                                  <span>Scheduled repayments due beyond one year, callable on covenant violation</span>
                                  <span>{formatCurrency(loanCallable)}</span>
                                </div>
                              </>
                            )}
                          </>
                        );
                      })()}
                      {summary.leaseCurrent > 0 && (() => {
                        const leaseCallable = summary.capitalLeases.reduce((s, l) => s + l.scheduledBeyondOneYear, 0);
                        const leaseWithin = summary.capitalLeases.reduce((s, l) => s + l.scheduledWithinOneYear, 0);
                        return (
                          <>
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Current portion of obligations under capital lease</span>
                              <span className="font-semibold">{formatCurrency(summary.leaseCurrent)}</span>
                            </div>
                            {leaseCallable > 0 && (
                              <>
                                <div className="flex justify-between px-1 py-1 pl-6 text-xs text-muted-foreground">
                                  <span>Scheduled repayments due within one year</span>
                                  <span>{formatCurrency(leaseWithin)}</span>
                                </div>
                                <div className="flex justify-between px-1 py-1 pl-6 text-xs text-muted-foreground">
                                  <span>Scheduled repayments due beyond one year, callable on covenant violation</span>
                                  <span>{formatCurrency(leaseCallable)}</span>
                                </div>
                              </>
                            )}
                          </>
                        );
                      })()}
                      {summary.deferredRentLiability > 0 && (
                        <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                          <span>Deferred rent (liability)</span>
                          <span className="font-semibold">{formatCurrency(summary.deferredRentLiability)}</span>
                        </div>
                      )}
                      {summary.leaseIncentiveCurrent > 0 && (
                        <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                          <span>Lease incentive liability — current</span>
                          <span className="font-semibold">{formatCurrency(summary.leaseIncentiveCurrent)}</span>
                        </div>
                      )}
                      {(summary.loanCurrent + summary.leaseCurrent + summary.deferredRentLiability + summary.leaseIncentiveCurrent) > 0 && (
                        <div className="flex justify-between px-1 py-2 border-t border-foreground/40 font-semibold">
                          <span>Total current liabilities</span>
                          <span>{formatCurrency(summary.loanCurrent + summary.leaseCurrent + summary.deferredRentLiability + summary.leaseIncentiveCurrent)}</span>
                        </div>
                      )}
                      {/* Non-current Liabilities */}
                      <div className="px-1 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Non-Current Liabilities</div>
                      {summary.loanLongTerm > 0 && (
                        <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                          <span>Long-term debt</span>
                          <span className="font-semibold">{formatCurrency(summary.loanLongTerm)}</span>
                        </div>
                      )}
                      {summary.leaseLongTerm > 0 && (
                        <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                          <span>Obligations under capital leases</span>
                          <span className="font-semibold">{formatCurrency(summary.leaseLongTerm)}</span>
                        </div>
                      )}
                      {summary.leaseIncentiveNonCurrent > 0 && (
                        <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                          <span>Lease incentive liability — non-current</span>
                          <span className="font-semibold">{formatCurrency(summary.leaseIncentiveNonCurrent)}</span>
                        </div>
                      )}
                      {(summary.loanLongTerm + summary.leaseLongTerm + summary.leaseIncentiveNonCurrent) > 0 && (
                        <div className="flex justify-between px-1 py-2 border-t border-foreground/40 font-semibold">
                          <span>Total non-current liabilities</span>
                          <span>{formatCurrency(summary.loanLongTerm + summary.leaseLongTerm + summary.leaseIncentiveNonCurrent)}</span>
                        </div>
                      )}
                      {/* Total Debt */}
                      {(summary.totalDebt > 0 || summary.deferredRentLiability > 0 || summary.leaseIncentiveLiability > 0) && (
                        <div className="flex justify-between px-1 py-3 mt-1 border-t-2 border-foreground/70 font-bold">
                          <span>Total Debt & Lease-Related Liabilities</span>
                          <span>{formatCurrency(summary.totalDebt + summary.deferredRentLiability + summary.leaseIncentiveLiability)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 2. STATEMENT OF OPERATIONS */}
                  <div className="rounded-xl border border-border/60 bg-card p-6 md:p-8 shadow-sm space-y-4 tabular-nums">
                    <h2 className="text-lg font-display font-semibold border-b pb-3">Statement of Operations — Relevant Line Items</h2>
                    <div className="overflow-hidden text-sm">
                      {(summary.totalInterestExpense > 0 || summary.totalStraightLineRentExpense > 0) ? (
                        <>
                          {summary.totalInterestExpense > 0 && (
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Interest expense — loans & capital leases</span>
                              <span className="font-semibold">{formatCurrency(summary.totalInterestExpense)}</span>
                            </div>
                          )}
                          {summary.totalStraightLineRentExpense > 0 && (
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Rent expense — operating leases (straight-line)</span>
                              <span className="font-semibold">{formatCurrency(summary.totalStraightLineRentExpense)}</span>
                            </div>
                          )}
                          {summary.totalLeaseInducementAmortization > 0 && (
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Lease inducement amortization (contra-expense)</span>
                              <span className="font-semibold">({formatCurrency(summary.totalLeaseInducementAmortization)})</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="p-3 text-sm text-muted-foreground">
                          No P&L impact for the current fiscal year. Interest and rent expenses are computed based on the fiscal year-end date.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 3. CASH FLOWS */}
                  <div className="rounded-xl border border-border/60 bg-card p-6 md:p-8 shadow-sm space-y-4 tabular-nums">
                    <h2 className="text-lg font-display font-semibold border-b pb-3">Cash Flows — Relevant Items</h2>
                    <div className="overflow-hidden text-sm">
                      {(summary.totalLoanProceeds > 0 || summary.totalPrincipalRepaid > 0 || summary.totalOperatingLeaseCash > 0 || summary.cashInducementsReceived > 0) ? (
                        <>
                          {summary.totalOperatingLeaseCash > 0 && (
                            <>
                              <div className="px-1 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Operating Activities</div>
                              <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                                <span>Rent paid — operating leases</span>
                                <span className="font-semibold">{formatCurrency(summary.totalOperatingLeaseCash)}</span>
                              </div>
                            </>
                          )}
                          <div className="px-1 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Financing Activities</div>
                          {summary.totalLoanProceeds > 0 && (
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Proceeds from long-term debt</span>
                              <span className="font-semibold">{formatCurrency(summary.totalLoanProceeds)}</span>
                            </div>
                          )}
                          {summary.cashInducementsReceived > 0 && (
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Lease inducements received in cash</span>
                              <span className="font-semibold">{formatCurrency(summary.cashInducementsReceived)}</span>
                            </div>
                          )}
                          {summary.totalLoanPrincipalRepaid > 0 && (
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Principal repayment — loans</span>
                              <span className="font-semibold">({formatCurrency(summary.totalLoanPrincipalRepaid)})</span>
                            </div>
                          )}
                          {summary.totalCapitalLeasePrincipalRepaid > 0 && (
                            <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                              <span>Principal repayment — capital leases</span>
                              <span className="font-semibold">({formatCurrency(summary.totalCapitalLeasePrincipalRepaid)})</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="p-3 text-sm text-muted-foreground">
                          No cash flow impact for the current fiscal year. Cash flow items are computed based on the fiscal year-end date.
                        </div>
                      )}
                    </div>
                    {summary.nonCashInducementsReceived > 0 && (
                      <div className="rounded-lg border border-dashed bg-muted/20 overflow-hidden text-sm">
                        <div className="px-1 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Non-cash transactions</div>
                        <div className="flex justify-between px-1 py-2.5 border-t border-border/50">
                          <span>Lease inducements received (non-cash)</span>
                          <span className="font-semibold">{formatCurrency(summary.nonCashInducementsReceived)}</span>
                        </div>
                        <div className="p-2 border-t text-xs text-muted-foreground">
                          Non-cash lease inducements (e.g. free rent periods or landlord-provided tenant improvements) are excluded from the statement of cash flows and disclosed here as a supplementary non-cash transaction.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. NOTE DISCLOSURES */}
                  {/* LONG TERM DEBT */}
                  {summary.loans.length > 0 && (
                    <div className="rounded-xl border border-border/60 bg-card p-6 md:p-8 shadow-sm space-y-4 tabular-nums">
                      <h2 className="text-lg font-display font-semibold border-b pb-3">Long Term Debt</h2>
                      <table className="w-full text-sm">
                        <tbody>
                          {groupByCounterparty(summary.loans, (l) => l.balanceAtYearEnd).map((group) => (
                            <Fragment key={group.key}>
                              {group.items.map((loan) => (
                                <tr key={loan.id} className="border-b last:border-0">
                                  <td className="py-3 pr-4 align-top w-[70%]">
                                    <p className="leading-relaxed">{loan.description}</p>
                                  </td>
                                  <td className="py-3 text-right align-top whitespace-nowrap font-semibold">
                                    {formatCurrency(loan.balanceAtYearEnd)}
                                  </td>
                                </tr>
                              ))}
                              {group.items.length > 1 && (
                                <tr className="border-b bg-muted/30">
                                  <td className="py-2 pr-4 pl-8 italic text-muted-foreground">
                                    Subtotal — {group.label}
                                  </td>
                                  <td className="py-2 text-right font-semibold">
                                    {formatCurrency(group.items.reduce((s, l) => s + l.balanceAtYearEnd, 0))}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                          <tr className="border-t-2">
                            <td className="py-3 pr-4"></td>
                            <td className="py-3 text-right font-semibold">{formatCurrency(summary.loanTotal)}</td>
                          </tr>
                          <tr>
                            <td className="py-1 pr-4 pl-4 text-muted-foreground">Amounts payable within one year</td>
                            <td className="py-1 text-right text-muted-foreground">({formatCurrency(summary.loanCurrent)})</td>
                          </tr>
                          <tr className="border-t-2">
                            <td className="py-3 pr-4"></td>
                            <td className="py-3 text-right font-bold">{formatCurrency(summary.loanLongTerm)}</td>
                          </tr>
                        </tbody>
                      </table>

                      {(() => {
                        const violated = summary.loans.filter((l) => l.covenantViolation);
                        if (violated.length === 0) return null;
                        const callable = violated.reduce((s, l) => s + l.scheduledBeyondOneYear, 0);
                        return (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm space-y-1">
                            <p className="font-semibold text-red-800">Covenant violation</p>
                            <p className="text-red-900 leading-relaxed">
                              As at year end, the Company was in violation of a financial covenant on {violated.length === 1 ? violated[0].name : `${violated.length} credit facilities`}. As a result, the lender is entitled to demand repayment and the entire outstanding balance of the affected debt has been classified as a current liability. Amounts otherwise scheduled for repayment beyond one year of {formatCurrency(callable)} are included in the current portion of long-term debt.
                            </p>
                          </div>
                        );
                      })()}

                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Principal repayment terms are approximately:</p>
                        <table className="w-full text-sm">
                          <tbody>
                            {(() => {
                              // Merge all loan year-by-year principal
                              const merged = new Map<string, number>();
                              for (const loan of summary.loans) {
                                for (const y of loan.yearlyPrincipal) {
                                  merged.set(y.label, (merged.get(y.label) ?? 0) + y.amount);
                                }
                              }
                              const entries = Array.from(merged.entries()).sort((a, b) => {
                                if (a[0] === "Thereafter") return 1;
                                if (b[0] === "Thereafter") return -1;
                                return Number(a[0]) - Number(b[0]);
                              });
                              const total = entries.reduce((s, [, v]) => s + v, 0);
                              return (
                                <>
                                  {entries.map(([label, amount]) => (
                                    <tr key={label} className="border-b">
                                      <td className="py-1 pr-4 pl-8">{label}</td>
                                      <td className="py-1 text-right">{formatCurrency(amount)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t-2">
                                    <td className="py-2 pr-4 pl-8 font-semibold"></td>
                                    <td className="py-2 text-right font-bold">{formatCurrency(total)}</td>
                                  </tr>
                                </>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* OBLIGATIONS UNDER CAPITAL LEASES */}
                  {summary.capitalLeases.length > 0 && (
                    <div className="rounded-xl border border-border/60 bg-card p-6 md:p-8 shadow-sm space-y-4 tabular-nums">
                      <h2 className="text-lg font-display font-semibold border-b pb-3">Obligations Under Capital Leases</h2>
                      <table className="w-full text-sm">
                        <tbody>
                          {groupByCounterparty(summary.capitalLeases, (l) => l.balanceAtYearEnd).map((group) => (
                            <Fragment key={group.key}>
                              {group.items.map((lease) => (
                                <tr key={lease.id} className="border-b last:border-0">
                                  <td className="py-3 pr-4 align-top w-[70%]">
                                    <p className="leading-relaxed">{lease.description}</p>
                                  </td>
                                  <td className="py-3 text-right align-top whitespace-nowrap font-semibold">
                                    {formatCurrency(lease.balanceAtYearEnd)}
                                  </td>
                                </tr>
                              ))}
                              {group.items.length > 1 && (
                                <tr className="border-b bg-muted/30">
                                  <td className="py-2 pr-4 pl-8 italic text-muted-foreground">
                                    Subtotal — {group.label}
                                  </td>
                                  <td className="py-2 text-right font-semibold">
                                    {formatCurrency(group.items.reduce((s, l) => s + l.balanceAtYearEnd, 0))}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                          <tr className="border-t-2">
                            <td className="py-3 pr-4"></td>
                            <td className="py-3 text-right font-semibold">{formatCurrency(summary.leaseTotal)}</td>
                          </tr>
                          <tr>
                            <td className="py-1 pr-4 pl-4 text-muted-foreground">Amounts payable within one year</td>
                            <td className="py-1 text-right text-muted-foreground">({formatCurrency(summary.leaseCurrent)})</td>
                          </tr>
                          <tr className="border-t-2">
                            <td className="py-3 pr-4"></td>
                            <td className="py-3 text-right font-bold">{formatCurrency(summary.leaseLongTerm)}</td>
                          </tr>
                        </tbody>
                      </table>

                      {(() => {
                        const violated = summary.capitalLeases.filter((l) => l.covenantViolation);
                        if (violated.length === 0) return null;
                        const callable = violated.reduce((s, l) => s + l.scheduledBeyondOneYear, 0);
                        return (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm space-y-1">
                            <p className="font-semibold text-red-800">Covenant violation</p>
                            <p className="text-red-900 leading-relaxed">
                              As at year end, the Company was in violation of a financial covenant on {violated.length === 1 ? violated[0].name : `${violated.length} lease obligations`}. As a result, the lessor is entitled to demand settlement and the entire outstanding obligation has been classified as a current liability. Amounts otherwise scheduled for repayment beyond one year of {formatCurrency(callable)} are included in the current portion of obligations under capital lease.
                            </p>
                          </div>
                        );
                      })()}

                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Future minimum capital lease payments are approximately:</p>
                        <table className="w-full text-sm">
                          <tbody>
                            {(() => {
                              const merged = new Map<string, number>();
                              for (const lease of summary.capitalLeases) {
                                for (const y of lease.yearlyBlended) {
                                  merged.set(y.label, (merged.get(y.label) ?? 0) + y.amount);
                                }
                              }
                              const entries = Array.from(merged.entries()).sort((a, b) => {
                                if (a[0] === "Thereafter") return 1;
                                if (b[0] === "Thereafter") return -1;
                                return Number(a[0]) - Number(b[0]);
                              });
                              const totalMinimum = entries.reduce((s, [, v]) => s + v, 0);
                              const totalObligations = summary.leaseTotal;
                              const impliedInterest = totalMinimum - totalObligations;
                              return (
                                <>
                                  {entries.map(([label, amount]) => (
                                    <tr key={label} className="border-b">
                                      <td className="py-1 pr-4 pl-8">{label}</td>
                                      <td className="py-1 text-right">{formatCurrency(amount)}</td>
                                    </tr>
                                  ))}
                                  <tr className="border-t">
                                    <td className="py-1 pr-4 pl-8">Total minimum payments</td>
                                    <td className="py-1 text-right">{formatCurrency(totalMinimum)}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-1 pr-4 pl-8 text-muted-foreground">Less interest amount at various rates</td>
                                    <td className="py-1 text-right text-muted-foreground">({formatCurrency(Math.max(0, impliedInterest))})</td>
                                  </tr>
                                  <tr className="border-t-2">
                                    <td className="py-2 pr-4 pl-8"></td>
                                    <td className="py-2 text-right font-bold">{formatCurrency(totalObligations)}</td>
                                  </tr>
                                </>
                              );
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* LEASE COMMITMENTS (Operating Leases) */}
                  {summary.operatingLeases.length > 0 && (
                    <div className="rounded-xl border border-border/60 bg-card p-6 md:p-8 shadow-sm space-y-4 tabular-nums">
                      <h2 className="text-lg font-display font-semibold border-b pb-3">Lease Commitments</h2>
                      <p className="text-sm text-muted-foreground">
                        The Company has long term leases with respect to its premises and equipment as follows:
                      </p>
                      <table className="w-full text-sm">
                        <tbody>
                          {groupByCounterparty(summary.operatingLeases, (o) =>
                            o.yearlyPayments.reduce((s, y) => s + y.amount, 0),
                          ).map((group) => (
                            <Fragment key={group.key}>
                              {group.items.map((op) => (
                                <tr key={op.id} className="border-b last:border-0">
                                  <td className="py-3 pr-4 align-top w-[70%]">
                                    <p className="leading-relaxed">{op.description}</p>
                                  </td>
                                  <td className="py-3 text-right align-top whitespace-nowrap font-semibold">
                                    {formatCurrency(op.yearlyPayments.reduce((s, y) => s + y.amount, 0))}
                                  </td>
                                </tr>
                              ))}
                              {group.items.length > 1 && (
                                <tr className="border-b bg-muted/30">
                                  <td className="py-2 pr-4 pl-8 italic text-muted-foreground">
                                    Subtotal — {group.label}
                                  </td>
                                  <td className="py-2 text-right font-semibold">
                                    {formatCurrency(
                                      group.items.reduce(
                                        (s, o) => s + o.yearlyPayments.reduce((ss, y) => ss + y.amount, 0),
                                        0,
                                      ),
                                    )}
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>

                      <p className="text-sm text-muted-foreground pt-2">
                        Future minimum lease payments are approximately:
                      </p>
                      <table className="w-full text-sm">
                        <tbody>
                          {(() => {
                            const merged = new Map<string, number>();
                            for (const op of summary.operatingLeases) {
                              for (const y of op.yearlyPayments) {
                                merged.set(y.label, (merged.get(y.label) ?? 0) + y.amount);
                              }
                            }
                            const entries = Array.from(merged.entries()).sort((a, b) => {
                              if (a[0] === "Thereafter") return 1;
                              if (b[0] === "Thereafter") return -1;
                              return Number(a[0]) - Number(b[0]);
                            });
                            const total = entries.reduce((s, [, v]) => s + v, 0);
                            return (
                              <>
                                {entries.map(([label, amount]) => (
                                  <tr key={label} className="border-b">
                                    <td className="py-1 pr-4 pl-4">{label}</td>
                                    <td className="py-1 text-right">{formatCurrency(amount)}</td>
                                  </tr>
                                ))}
                                <tr className="border-t-2">
                                  <td className="py-2 pr-4 pl-4"></td>
                                  <td className="py-2 text-right font-bold">{formatCurrency(total)}</td>
                                </tr>
                              </>
                            );
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setEditingLoanId(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              {(() => {
                if (!editingLoanId) return form.isCapitalLease ? "Add New Capital Lease" : "Add New Loan";
                const loan = loans?.find((l) => l.id === editingLoanId);
                if (!loan) return "Edit Loan";
                const isOperating = !loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null;
                if (loan.isCapitalLease) return "Edit Capital Lease";
                if (isOperating) return "Edit Operating Lease";
                return "Edit Loan";
              })()}
            </DialogTitle>
            <DialogDescription>
              {(() => {
                if (!editingLoanId) return form.isCapitalLease ? "Create a new capital lease entry." : "Create a new loan entry.";
                const loan = loans?.find((l) => l.id === editingLoanId);
                if (!loan) return "Update loan parameters.";
                const isOperating = !loan.isCapitalLease && Number(loan.interestRate) === 0 && loan.monthlyPayment != null;
                if (loan.isCapitalLease || isOperating) return "Update lease parameters. To re-run the assessment, use the Reevaluate Lease button on the detail page.";
                return "Update loan parameters.";
              })()}
            </DialogDescription>
          </DialogHeader>
          <LoanFormFields form={form} setForm={setForm} mode={formMode} />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); setEditingLoanId(null); }}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const validationError = validateLoanForm(form, formMode);
                if (validationError) {
                  toast({ title: "Missing information", description: validationError, variant: "destructive" });
                  return;
                }
                {
                  if (editingLoanId) {
                    updateLoan.mutate({
                      id: editingLoanId,
                      data: {
                        name: form.name,
                        description: form.description || undefined,
                        counterparty: form.counterparty,
                        isCapitalLease: form.isCapitalLease,
                        principal: form.principal,
                        downPayment: form.downPayment,
                        interestRate: form.interestRate,
                        amortizationYears: form.amortizationYears,
                        termYears: form.termYears,
                        startDate: form.startDate,
                        paymentFrequency: form.paymentFrequency,
                        ioMonths: form.ioMonths,
                        balloonPayment: form.balloonPayment,
                        transferOfOwnership: form.transferOfOwnership,
                        bargainPurchaseOption: form.bargainPurchaseOption,
                        leaseTermPct: form.leaseTermPct,
                        pvPctFairValue: form.pvPctFairValue,
                        fairValue: form.fairValue || null,
                        specializedAsset: form.specializedAsset,
                        assetDescription: form.assetDescription || null,
                        assetCost: form.assetCost || null,
                        assetUsefulLife: form.assetUsefulLife || null,
                        capitalLeaseRationale: form.capitalLeaseRationale || null,
                        monthlyPayment: form.monthlyPayment,
                        paymentOverride: form.paymentOverride ?? null,
                        termMonths: form.termMonths,
                        isOfficeProperty: form.isOfficeProperty,
                        freeRentMonths: form.freeRentMonths,
                        rentEscalationRate: form.rentEscalationRate,
                        rentSteps: form.rentSteps.length > 0 ? form.rentSteps : null,
                        tenantImprovementAllowance: form.tenantImprovementAllowance,
                        otherInducements: form.otherInducements,
                        inducementReceivedInCash: form.inducementReceivedInCash,
                        covenantViolation: form.covenantViolation,
                        fvRate: form.fvRate,
                        fvDecision: form.fvDecision,
                        fvDecisionNote: form.fvDecisionNote || undefined,
                        securityClauses: form.securityClauses,
                        collateralType: form.collateralType || null,
                        collateralDescription: form.collateralDescription || null,
                        collateralDepreciableCost: form.collateralDepreciableCost || null,
                        collateralLandCost: form.collateralLandCost || null,
                        collateralInServiceDate: form.collateralInServiceDate || null,
                        collateralMethod: form.collateralMethod || null,
                        collateralUsefulLifeYears: form.collateralUsefulLifeYears || null,
                        collateralDecliningRate: form.collateralDecliningRate || null,
                        collateralSalvageValue: form.collateralSalvageValue || null,
                      },
                    });
                  } else {
                    createLoan.mutate({
                      id: fileId,
                      data: {
                        name: form.name,
                        description: form.description || undefined,
                        counterparty: form.counterparty,
                        isCapitalLease: form.isCapitalLease,
                        principal: form.principal,
                        downPayment: form.downPayment,
                        interestRate: form.interestRate,
                        amortizationYears: form.amortizationYears,
                        termYears: form.termYears,
                        startDate: form.startDate,
                        fiscalYearEnd: file?.fiscalYearEnd ?? form.startDate,
                        paymentFrequency: form.paymentFrequency,
                        ioMonths: form.ioMonths,
                        balloonPayment: form.balloonPayment,
                        transferOfOwnership: form.transferOfOwnership,
                        bargainPurchaseOption: form.bargainPurchaseOption,
                        leaseTermPct: form.leaseTermPct,
                        pvPctFairValue: form.pvPctFairValue,
                        fairValue: form.fairValue || undefined,
                        specializedAsset: form.specializedAsset,
                        assetDescription: form.assetDescription || undefined,
                        assetCost: form.assetCost || undefined,
                        assetUsefulLife: form.assetUsefulLife || undefined,
                        capitalLeaseRationale: form.capitalLeaseRationale || undefined,
                        monthlyPayment: form.monthlyPayment,
                        paymentOverride: form.paymentOverride ?? null,
                        termMonths: form.termMonths,
                        isOfficeProperty: form.isOfficeProperty,
                        freeRentMonths: form.freeRentMonths,
                        rentEscalationRate: form.rentEscalationRate,
                        rentSteps: form.rentSteps.length > 0 ? form.rentSteps : undefined,
                        tenantImprovementAllowance: form.tenantImprovementAllowance,
                        otherInducements: form.otherInducements,
                        inducementReceivedInCash: form.inducementReceivedInCash,
                        covenantViolation: form.covenantViolation,
                        fvRate: form.fvRate,
                        fvDecision: form.fvDecision,
                        fvDecisionNote: form.fvDecisionNote || undefined,
                        securityClauses: form.securityClauses,
                        collateralType: form.collateralType || null,
                        collateralDescription: form.collateralDescription || null,
                        collateralDepreciableCost: form.collateralDepreciableCost || null,
                        collateralLandCost: form.collateralLandCost || null,
                        collateralInServiceDate: form.collateralInServiceDate || null,
                        collateralMethod: form.collateralMethod || null,
                        collateralUsefulLifeYears: form.collateralUsefulLifeYears || null,
                        collateralDecliningRate: form.collateralDecliningRate || null,
                        collateralSalvageValue: form.collateralSalvageValue || null,
                        sourceDocumentBlob: pendingSourceDoc?.blob,
                        sourceDocumentName: pendingSourceDoc?.name,
                      },
                    });
                  }
                }
              }}
              disabled={validateLoanForm(form, formMode) !== null || createLoan.isPending || updateLoan.isPending}
            >
              {editingLoanId
                ? updateLoan.isPending ? "Saving..." : "Save Changes"
                : createLoan.isPending ? "Creating..." : form.isCapitalLease ? "Create Capital Lease" : "Create Loan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImportDocumentDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        fileId={fileId}
        onUseLoan={handleImportedLoan}
        onUseLease={handleImportedLease}
      />

      <CapitalLeaseAssessment
        open={assessmentOpen}
        onOpenChange={setAssessmentOpen}
        initialAnswers={importedAnswers}
        initialStraightLine={importedStraightLine}
        initialStep={importedAnswers ? 0 : undefined}
        importedNotes={importedNotes}
        importedEstimates={importedEstimates}
        onConfirm={(result) => {
          setAssessmentResult(result);
          if (result.isCapitalLease) {
            const termYears = Math.ceil(result.answers.termMonths / 12);
            setForm({
              name: importedLeaseMeta?.name ?? "",
              description: "",
              counterparty: importedLeaseMeta?.lessor ?? null,
              isCapitalLease: true,
              principal: result.pvValue > 0 ? result.pvValue : result.answers.fairValue,
              downPayment: result.answers.downPayment,
              interestRate: result.answers.interestRate,
              amortizationYears: result.answers.assetType ? Math.min(termYears, Math.max(3, Math.ceil(result.answers.economicLife))) : termYears,
              termYears: termYears,
              startDate: importedLeaseMeta?.startDate ?? "",
              paymentFrequency: "monthly",
              ioMonths: 0,
              balloonPayment: 0,
              transferOfOwnership: result.answers.transferOfOwnership,
              bargainPurchaseOption: result.answers.bargainPurchaseOption,
              leaseTermPct: result.answers.leaseTermPct,
              pvPctFairValue: result.answers.pvPctFairValue,
              fairValue: result.answers.fairValue,
              specializedAsset: result.answers.specializedAsset,
              assetDescription: formatAssetType(result.answers.assetType) || "",
              assetCost: result.answers.fairValue || 0,
              assetUsefulLife: result.answers.economicLife || 0,
              capitalLeaseRationale: result.rationale,
              monthlyPayment: undefined,
              paymentOverride: undefined,
              termMonths: undefined,
              isOfficeProperty: false,
              freeRentMonths: 0,
              rentEscalationRate: 0,
              rentSteps: [],
              tenantImprovementAllowance: 0,
              otherInducements: 0,
              inducementReceivedInCash: false,
              covenantViolation: false,
              fvRate: undefined,
              fvDecision: undefined,
              fvDecisionNote: "",
              securityClauses: [],
              collateralType: "equipment",
              collateralDescription: formatAssetType(result.answers.assetType) || "",
              collateralDepreciableCost: result.answers.fairValue || 0,
              collateralLandCost: 0,
              collateralInServiceDate: "",
              collateralMethod: "straight_line",
              collateralUsefulLifeYears: result.answers.economicLife || 0,
              collateralDecliningRate: 0,
              collateralSalvageValue: 0,
            });
            setEditingLoanId(null);
            setCreateOpen(true);
          } else {
            setOperatingLeaseResult(result);
            setOperatingStartDate(importedLeaseMeta?.startDate ?? "");
            setOperatingCounterparty(importedLeaseMeta?.lessor ?? null);
            setOperatingDialogOpen(true);
          }
        }}
      />

      {/* Operating Lease Disclosure Dialog */}
      <Dialog open={operatingDialogOpen} onOpenChange={setOperatingDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Operating Lease — ASPE Disclosure
            </DialogTitle>
            <DialogDescription>
              This lease does not meet any capital lease criteria. Under ASPE 3065, treat this as an operating lease. Lease payments are expensed on a straight-line basis — no asset or liability is recorded.
            </DialogDescription>
          </DialogHeader>

          {(() => {
            const r = operatingLeaseResult;
            if (!r) return null;
            const termYears = Math.ceil(r.answers.termMonths / 12);
            const annualPayment = r.answers.monthlyPayment * 12;

            // Straight-line computation
            const sl = (file && r.straightLine && operatingStartDate)
              ? calculateStraightLineLease({
                  baseMonthlyRent: r.answers.monthlyPayment,
                  termMonths: r.answers.termMonths,
                  freeRentMonths: r.straightLine.freeRentMonths || 0,
                  escalationRate: r.straightLine.rentEscalationRate || 0,
                  rentSteps: r.straightLine.rentSteps ?? [],
                  tenantImprovementAllowance: r.straightLine.tenantImprovementAllowance || 0,
                  otherInducements: r.straightLine.otherInducements || 0,
                  startDate: operatingStartDate,
                  fiscalYearEnd: file.fiscalYearEnd,
                })
              : null;
            const yearly = sl ? buildYearlyStraightLine(sl.schedule) : [];

            // Cash commitment table — group actual payments by fiscal year
            const cashByFy = new Map<number, number>();
            if (sl) {
              for (const p of sl.schedule) {
                cashByFy.set(p.fiscalYear, (cashByFy.get(p.fiscalYear) ?? 0) + p.actualPayment);
              }
            }
            const entries = Array.from(cashByFy.entries()).sort((a, b) => a[0] - b[0]);
            const yearsCash: { label: string; amount: number }[] = [];
            let thereafterCash = 0;
            for (let i = 0; i < entries.length; i++) {
              if (i < 5) {
                yearsCash.push({ label: `${entries[i][0]}`, amount: entries[i][1] });
              } else {
                thereafterCash += entries[i][1];
              }
            }
            const totalPayments = yearsCash.reduce((s, y) => s + y.amount, 0) + thereafterCash;

            return (
              <div className="space-y-6 py-4">
                <div className="p-4 rounded-lg border bg-amber-50 border-amber-200">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <p className="font-semibold font-display">Operating Lease</p>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{r.rationale}</p>
                </div>

                {/* Inception Date */}
                <div className="space-y-2">
                  <Label htmlFor="op-start-date">Lease Inception Date</Label>
                  <Input
                    id="op-start-date"
                    type="date"
                    value={operatingStartDate}
                    onChange={(e) => setOperatingStartDate(e.target.value)}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Required for straight-line calculations and ASPE disclosure.
                  </p>
                </div>

                {/* Counterparty (Landlord) */}
                <div className="space-y-2">
                  <Label htmlFor="op-counterparty">Landlord / Counterparty</Label>
                  <CounterpartyCombobox
                    id="op-counterparty"
                    value={operatingCounterparty}
                    onChange={setOperatingCounterparty}
                  />
                </div>

                {/* Straight-Line Expense Table */}
                {sl && (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-sm">Annual Straight-Line Lease Expense — P&L</h4>
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left p-2 font-medium">Fiscal Year</th>
                            <th className="text-right p-2 font-medium">Actual Cash</th>
                            <th className="text-right p-2 font-medium">SL Expense</th>
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
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div className="rounded-lg border p-2 bg-muted/30">
                        <p className="text-xs text-muted-foreground">Total Lease Payments</p>
                        <p className="font-semibold">{formatCurrency(sl.totalLeasePayments)}</p>
                      </div>
                      <div className="rounded-lg border p-2 bg-muted/30">
                        <p className="text-xs text-muted-foreground">Less: Inducements</p>
                        <p className="font-semibold">{formatCurrency(sl.totalInducements)}</p>
                      </div>
                      <div className="rounded-lg border p-2 bg-primary/5 border-primary/20">
                        <p className="text-xs text-primary font-medium">Net Consideration</p>
                        <p className="font-semibold text-primary">{formatCurrency(sl.totalConsideration)}</p>
                      </div>
                      <div className="rounded-lg border p-2 bg-primary/5 border-primary/20">
                        <p className="text-xs text-primary font-medium">Monthly SL Expense</p>
                        <p className="font-semibold text-primary">{formatCurrency(sl.monthlyStraightLineExpense)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Originating Entries */}
                {sl && (r.straightLine) && (r.straightLine.tenantImprovementAllowance > 0 || r.straightLine.otherInducements > 0) && (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-sm">Originating Journal Entries — Lease Inducements</h4>
                    {r.straightLine.tenantImprovementAllowance > 0 && (
                      <div className="rounded-lg border overflow-hidden text-sm">
                        <div className="bg-muted/40 p-2 text-xs font-medium text-muted-foreground">
                          At lease inception — Tenant Improvement Allowance
                        </div>
                        <table className="w-full">
                          <tbody>
                            <tr className="border-t">
                              <td className="p-2">Dr. Cash / Leasehold Improvements</td>
                              <td className="p-2 text-right">{formatCurrency(r.straightLine.tenantImprovementAllowance)}</td>
                            </tr>
                            <tr className="border-t">
                              <td className="p-2 pl-6">Cr. Lease Incentive Liability</td>
                              <td className="p-2 text-right">{formatCurrency(r.straightLine.tenantImprovementAllowance)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                    {r.straightLine.otherInducements > 0 && (
                      <div className="rounded-lg border overflow-hidden text-sm">
                        <div className="bg-muted/40 p-2 text-xs font-medium text-muted-foreground">
                          At lease inception — Other Inducements
                        </div>
                        <table className="w-full">
                          <tbody>
                            <tr className="border-t">
                              <td className="p-2">Dr. Cash</td>
                              <td className="p-2 text-right">{formatCurrency(r.straightLine.otherInducements)}</td>
                            </tr>
                            <tr className="border-t">
                              <td className="p-2 pl-6">Cr. Lease Incentive Liability</td>
                              <td className="p-2 text-right">{formatCurrency(r.straightLine.otherInducements)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* Recurring Monthly Entries */}
                {sl && (() => {
                  const cashVaries = (r.straightLine?.freeRentMonths ?? 0) > 0 || (r.straightLine?.rentEscalationRate ?? 0) > 0 || (r.straightLine?.rentSteps?.length ?? 0) > 0;
                  return (
                  <div className="space-y-3">
                    <h4 className="font-semibold text-sm">Recurring Monthly Journal Entry</h4>
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
                            <td className="p-2 text-right">{formatCurrency(r.answers.monthlyPayment)}</td>
                          </tr>
                          <tr className="border-t">
                            <td className="p-2 pl-6">
                              {sl.monthlyStraightLineExpense > r.answers.monthlyPayment ? "Cr. Deferred Rent" : sl.monthlyStraightLineExpense < r.answers.monthlyPayment ? "Dr. Deferred Rent" : "Deferred Rent (no difference)"}
                            </td>
                            <td className="p-2 text-right">{formatCurrency(Math.abs(sl.monthlyStraightLineExpense - r.answers.monthlyPayment))}</td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="bg-muted/50 border-t p-2 text-xs text-muted-foreground">
                        <p>
                          <strong>Note:</strong> The deferred rent balance flips from asset to liability over the lease term when cash exceeds the straight-line expense. Review the year-end balance in the table above.
                        </p>
                      </div>
                    </div>
                  </div>
                  );
                })()}

                {/* Cash Commitment Table (footnote disclosure) */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Minimum Lease Payments — Next 5 Years & Thereafter (Footnote Disclosure)</h4>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium">Period</th>
                          <th className="text-right p-2 font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {yearsCash.map((y) => (
                          <tr key={y.label} className="border-t">
                            <td className="p-2">{y.label}</td>
                            <td className="p-2 text-right">{formatCurrency(y.amount)}</td>
                          </tr>
                        ))}
                        {thereafterCash > 0 && (
                          <tr className="border-t">
                            <td className="p-2">Thereafter</td>
                            <td className="p-2 text-right">{formatCurrency(thereafterCash)}</td>
                          </tr>
                        )}
                        <tr className="border-t font-semibold bg-muted/30">
                          <td className="p-2">Total Minimum Lease Payments</td>
                          <td className="p-2 text-right">{formatCurrency(totalPayments)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="font-semibold text-sm">Lease Summary</h4>
                  <div className="rounded-lg border p-3 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Monthly Payment</span><span className="font-semibold">{formatCurrency(r.answers.monthlyPayment)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Lease Term</span><span className="font-semibold">{r.answers.termMonths} months</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Annual Payment</span><span className="font-semibold">{formatCurrency(annualPayment)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Asset Type</span><span className="font-semibold">{formatAssetType(r.answers.assetType) || "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Fair Value</span><span className="font-semibold">{formatCurrency(r.answers.fairValue)}</span></div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="p-3 rounded-lg bg-muted/50 border text-xs text-muted-foreground space-y-1">
                    <p className="font-semibold text-foreground">Accounting Guidance</p>
                    <p><strong>Income statement:</strong> Operating lease expense must be recognized on a straight-line basis. Inducements reduce the total consideration, which is amortized evenly over the lease term.</p>
                    <p><strong>Footnote disclosure:</strong> Future minimum lease payments are shown undiscounted by fiscal year (the cash commitment table above).</p>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    <p><strong>Why two tables?</strong> The P&L expense is the <em>straight-line</em> amount (it changes when you add TI allowances, free rent, or escalations). The footnote shows the <em>undiscounted cash</em> you contractually owe — this is required by ASPE 3065 but does NOT affect the P&L.</p>
                  </div>
                </div>
              </div>
            );
          })()}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setOperatingDialogOpen(false)} className="gap-2">
              Close
            </Button>
            <Button
              onClick={() => {
                const r = operatingLeaseResult;
                if (!r || !file) return;
                const termYears = Math.ceil(r.answers.termMonths / 12);
                // Total cash commitment must respect rent steps and free-rent
                // months, not just first-year rent × term.
                const slPreview = calculateStraightLineLease({
                  baseMonthlyRent: r.answers.monthlyPayment,
                  termMonths: r.answers.termMonths,
                  freeRentMonths: r.straightLine?.freeRentMonths ?? 0,
                  escalationRate: r.straightLine?.rentEscalationRate ?? 0,
                  rentSteps: r.straightLine?.rentSteps,
                  startDate: operatingStartDate,
                  fiscalYearEnd: file.fiscalYearEnd,
                });
                const totalCommitment =
                  slPreview?.totalLeasePayments ?? r.answers.monthlyPayment * r.answers.termMonths;
                const descParts = [
                  `Operating lease${operatingCounterparty ? ` with ${operatingCounterparty}` : ""}.`,
                  `Monthly payment: ${formatCurrency(r.answers.monthlyPayment)}, Term: ${r.answers.termMonths} months.`,
                ];
                if (r.straightLine?.rentSteps?.length) descParts.push("Rent steps over the term.");
                if ((r.straightLine?.camMonthly ?? 0) > 0)
                  descParts.push(`CAM/operating costs ${formatCurrency(r.straightLine!.camMonthly)}/month (executory costs, expensed as billed).`);
                if (importedPercentageRent)
                  descParts.push(`Percentage rent: ${importedPercentageRent} Contingent rent — expensed as incurred, excluded from minimum lease payments.`);
                createLoan.mutate({
                  id: fileId,
                  data: {
                    name: `${formatAssetType(r.answers.assetType) || "Lease"} — Operating Lease`,
                    description: descParts.join(" "),
                    counterparty: operatingCounterparty,
                    isCapitalLease: false,
                    principal: totalCommitment,
                    interestRate: 0,
                    amortizationYears: termYears,
                    termYears,
                    startDate: operatingStartDate,
                    fiscalYearEnd: file.fiscalYearEnd,
                    paymentFrequency: "monthly",
                    ioMonths: 0,
                    balloonPayment: 0,
                    transferOfOwnership: r.answers.transferOfOwnership,
                    bargainPurchaseOption: r.answers.bargainPurchaseOption,
                    leaseTermPct: r.answers.leaseTermPct,
                    pvPctFairValue: r.answers.pvPctFairValue,
                    fairValue: r.answers.fairValue || undefined,
                    specializedAsset: r.answers.specializedAsset,
                    capitalLeaseRationale: r.rationale,
                    monthlyPayment: r.answers.monthlyPayment,
                    termMonths: r.answers.termMonths,
                    isOfficeProperty: r.isOfficeProperty,
                    freeRentMonths: r.straightLine?.freeRentMonths ?? 0,
                    rentEscalationRate: r.straightLine?.rentEscalationRate ?? 0,
                    rentSteps: r.straightLine?.rentSteps?.length ? r.straightLine.rentSteps : undefined,
                    tenantImprovementAllowance: r.straightLine?.tenantImprovementAllowance ?? 0,
                    camMonthly: (r.straightLine?.camMonthly ?? 0) > 0 ? r.straightLine!.camMonthly : undefined,
                    otherInducements: r.straightLine?.otherInducements ?? 0,
                    inducementReceivedInCash: r.straightLine?.inducementReceivedInCash ?? false,
                    sourceDocumentBlob: pendingSourceDoc?.blob,
                    sourceDocumentName: pendingSourceDoc?.name,
                  },
                });
                setOperatingDialogOpen(false);
                setOperatingStartDate("");
                setOperatingCounterparty(null);
                setImportedPercentageRent(null);
              }}
              disabled={createLoan.isPending || !operatingStartDate}
              className="gap-2"
            >
              <FileText className="h-4 w-4" />
              {createLoan.isPending ? "Saving..." : "Save to Year-End File"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Edit Year-End File</DialogTitle>
            <DialogDescription>
              Update the fiscal year end, reference name, and materiality thresholds.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="editFileFYE">Fiscal Year End</Label>
              <Input
                id="editFileFYE"
                type="date"
                value={editFileYearEnd}
                onChange={(e) => setEditFileYearEnd(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editFileName">Name / Reference</Label>
              <Input
                id="editFileName"
                value={editFileName}
                onChange={(e) => setEditFileName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="editTrivial">Trivial Threshold ($)</Label>
                <Input
                  id="editTrivial"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 5000"
                  value={editTrivialThreshold ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditTrivialThreshold(v === "" ? undefined : Number(v));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">FV diffs below this → trivial</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="editMateriality">Materiality ($)</Label>
                <Input
                  id="editMateriality"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="e.g. 50000"
                  value={editMateriality ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditMateriality(v === "" ? undefined : Number(v));
                  }}
                />
                <p className="text-[11px] text-muted-foreground">FV diffs above this → material</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editFileName && editFileYearEnd) {
                  updateFile.mutate({
                    id: fileId,
                    data: {
                      name: editFileName,
                      fiscalYearEnd: editFileYearEnd,
                      trivialThreshold: editTrivialThreshold,
                      materiality: editMateriality,
                    },
                  });
                }
              }}
              disabled={!editFileName || !editFileYearEnd || updateFile.isPending}
            >
              {updateFile.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Roll Forward File Dialog */}
      <Dialog open={rollForwardOpen} onOpenChange={setRollForwardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Roll Forward Year-End File</DialogTitle>
            <DialogDescription>
              Create a new year-end file for the next fiscal year end and copy all outstanding loans.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="newFYE">New Fiscal Year End</Label>
              <Input
                id="newFYE"
                type="date"
                value={newYearEnd}
                onChange={(e) => setNewYearEnd(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRollForwardOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (newYearEnd) {
                  rollForward.mutate({
                    id: fileId,
                    data: { newFiscalYearEnd: newYearEnd },
                  });
                }
              }}
              disabled={!newYearEnd || rollForward.isPending}
            >
              {rollForward.isPending ? "Rolling..." : "Roll Forward"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          if (deleteTarget) deleteLoan.mutate({ id: deleteTarget });
        }}
        title="Delete Loan?"
        description="This will permanently delete this loan and its schedule. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
      />
    </div>
  );
}
