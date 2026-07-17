import { useRef, useState } from "react";
import { useImportDocument, type DocumentImportResult } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { toast } from "@/hooks/use-toast";
import { getErrorMessage } from "@/lib/errors";
import { FileUp, FileText, Loader2, Landmark, Receipt, HelpCircle, Settings, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/format";

type FieldRow = { label: string; value: string | null; optional?: boolean };

function fmtMoney(v: number | null | undefined): string | null {
  return v == null ? null : formatCurrency(v);
}
function fmtNum(v: number | null | undefined, suffix = ""): string | null {
  return v == null ? null : `${v}${suffix}`;
}
function fmtBool(v: boolean | null | undefined): string | null {
  return v == null ? null : v ? "Yes" : "No";
}
function fmtText(v: string | null | undefined): string | null {
  return v == null || v === "" ? null : v;
}

function buildFieldRows(result: DocumentImportResult): FieldRow[] {
  if (result.classification === "loan") {
    const f = result.loan;
    return [
      { label: "Loan name", value: fmtText(f?.name) },
      { label: "Lender", value: fmtText(f?.lender) },
      { label: "Principal", value: fmtMoney(f?.principal) },
      { label: "Down payment", value: fmtMoney(f?.downPayment), optional: true },
      { label: "Interest rate", value: fmtNum(f?.interestRate, "%") },
      { label: "Amortization", value: fmtNum(f?.amortizationYears, " years") },
      { label: "Term", value: fmtNum(f?.termYears, " years") },
      { label: "Start date", value: fmtText(f?.startDate) },
      { label: "Payment frequency", value: fmtText(f?.paymentFrequency ?? null) },
      { label: "Payment amount", value: fmtMoney(f?.paymentAmount) },
      { label: "Interest-only period", value: fmtNum(f?.interestOnlyMonths, " months"), optional: true },
      { label: "Balloon payment", value: fmtMoney(f?.balloonPayment), optional: true },
      { label: "Security / collateral", value: fmtText(f?.securityDescription) },
    ];
  }
  if (result.classification === "lease") {
    const f = result.lease;
    return [
      { label: "Lease name", value: fmtText(f?.name) },
      { label: "Lessor", value: fmtText(f?.lessor) },
      { label: "Asset", value: fmtText(f?.assetDescription) },
      { label: "Asset type", value: fmtText(f?.assetType ?? null) },
      { label: "Start date", value: fmtText(f?.startDate) },
      { label: "Term", value: fmtNum(f?.termMonths, " months") },
      { label: "Monthly payment", value: fmtMoney(f?.monthlyPayment) },
      { label: "Down payment", value: fmtMoney(f?.downPayment), optional: true },
      { label: "Interest rate", value: fmtNum(f?.interestRate, "%") },
      { label: "Fair value", value: fmtMoney(f?.fairValue) },
      { label: "Economic life", value: fmtNum(f?.economicLifeYears, " years") },
      { label: "Buyout amount", value: fmtMoney(f?.buyoutAmount), optional: true },
      { label: "Ownership transfers", value: fmtBool(f?.transferOfOwnership) },
      { label: "Bargain purchase option", value: fmtBool(f?.bargainPurchaseOption) },
      { label: "Specialized asset", value: fmtBool(f?.specializedAsset) },
      { label: "Payments at start of period", value: fmtBool(f?.paymentAtBeginning) },
      { label: "Rentable area", value: fmtNum(f?.rentableSquareFeet, " sq ft"), optional: true },
      {
        label: "Rent schedule",
        value: f?.rentSteps?.length
          ? f.rentSteps
              .map((s) =>
                s.fromYear === s.toYear
                  ? `Yr ${s.fromYear}: ${fmtMoney(s.monthlyRent)}/mo`
                  : `Yrs ${s.fromYear}–${s.toYear}: ${fmtMoney(s.monthlyRent)}/mo`,
              )
              .join("; ")
          : null,
        optional: true,
      },
      { label: "Tenant improvement allowance", value: fmtMoney(f?.tenantImprovementAllowance), optional: true },
      { label: "Free rent period", value: fmtNum(f?.freeRentMonths, " months"), optional: true },
    ];
  }
  return [];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
  onUseLoan: (result: DocumentImportResult) => void;
  onUseLease: (result: DocumentImportResult) => void;
}

export default function ImportDocumentDialog({ open, onOpenChange, fileId, onUseLoan, onUseLease }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<DocumentImportResult | null>(null);
  const [settingsHint, setSettingsHint] = useState(false);

  const importDoc = useImportDocument({
    mutation: {
      onSuccess: (data) => {
        setResult(data);
      },
      onError: (err) => {
        const message = getErrorMessage(err);
        setSettingsHint(/settings/i.test(message));
        toast({ title: "Couldn't read the document", description: message, variant: "destructive" });
      },
    },
  });

  const reset = () => {
    setSelected(null);
    setResult(null);
    setSettingsHint(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const confidencePct = result ? Math.round(result.confidence * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <FileUp className="h-5 w-5 text-primary" />
            Import from PDF
          </DialogTitle>
          <DialogDescription>
            Upload a loan or lease agreement (PDF). The document is read automatically and the
            details are used to prefill the form — you can review everything before saving.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="space-y-3 py-2">
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={importDoc.isPending}
              onDragOver={(e) => {
                e.preventDefault();
                if (!importDoc.isPending) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (importDoc.isPending) return;
                const file = e.dataTransfer.files?.[0];
                if (!file) return;
                const isPdf =
                  file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
                if (!isPdf) {
                  toast({
                    title: "Not a PDF",
                    description: "Please drop a PDF file (.pdf).",
                    variant: "destructive",
                  });
                  return;
                }
                setSelected(file);
              }}
              className={`w-full rounded-xl border-2 border-dashed transition-colors p-8 text-center cursor-pointer disabled:opacity-60 ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
            >
              <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              {selected ? (
                <p className="text-sm font-medium">{selected.name}</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Click to choose a PDF file, or drag and drop it here (max 20 MB)
                </p>
              )}
            </button>
            {settingsHint && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center gap-2">
                <Settings className="h-4 w-4 shrink-0" />
                <span>
                  Azure credentials are missing. Enter them on the{" "}
                  <Link href="/settings" className="underline font-medium" onClick={() => handleOpenChange(false)}>
                    Settings page
                  </Link>{" "}
                  first.
                </span>
              </p>
            )}
          </div>
        )}

        {importDoc.isPending && (
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reading the document… this can take up to a minute.
          </div>
        )}

        {result && (
          <div className="space-y-3 py-2">
            <div className="rounded-lg border p-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Detected document type</span>
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  {result.classification === "loan" && <Landmark className="h-4 w-4 text-primary" />}
                  {result.classification === "lease" && <Receipt className="h-4 w-4 text-amber-600" />}
                  {result.classification === "other" && <HelpCircle className="h-4 w-4 text-muted-foreground" />}
                  {result.classification === "loan" ? "Loan" : result.classification === "lease" ? "Lease" : "Not a loan or lease"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Confidence</span>
                <span className="font-semibold">{confidencePct}%</span>
              </div>
              <p className="text-xs text-muted-foreground border-t pt-2">{result.reasoning}</p>
            </div>
            {result.classification !== "other" && (() => {
              const rows = buildFieldRows(result);
              // Leases rarely state the interest rate or the asset's fair
              // value — the assessment wizard has tools for both, so show
              // guidance instead of a warning for those two.
              const leaseWizardFields = ["Interest rate", "Fair value"];
              const isLease = result.classification === "lease";
              const missing = rows.filter(
                (r) =>
                  r.value === null &&
                  !r.optional &&
                  !(isLease && leaseWizardFields.includes(r.label)),
              );
              const missingWizardFields = isLease
                ? rows.filter((r) => r.value === null && leaseWizardFields.includes(r.label))
                : [];
              return (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Extracted details — review before continuing
                  </p>
                  <div className="rounded-lg border divide-y max-h-56 overflow-y-auto text-sm">
                    {rows.map((r) => (
                      <div key={r.label} className="flex items-center justify-between gap-3 px-3 py-1.5">
                        <span className="text-muted-foreground">{r.label}</span>
                        {r.value !== null ? (
                          <span className="font-medium text-right">{r.value}</span>
                        ) : r.optional ? (
                          <span className="text-xs text-muted-foreground">Not stated</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            Not found
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  {missing.length > 0 && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-start gap-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        {missing.length} {missing.length === 1 ? "detail wasn't" : "details weren't"} found
                        in the document ({missing.map((m) => m.label.toLowerCase()).join(", ")}). You'll
                        need to fill {missing.length === 1 ? "it" : "these"} in yourself on the next step —
                        nothing has been guessed for you.
                      </span>
                    </p>
                  )}
                  {missingWizardFields.length > 0 && (
                    <p className="text-xs text-muted-foreground bg-muted/50 border rounded-lg p-2 flex items-start gap-2">
                      <HelpCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>
                        The document doesn't state the{" "}
                        {missingWizardFields.map((m) => m.label.toLowerCase()).join(" or ")} — that's
                        normal for leases. In the assessment you can use your company's incremental
                        borrowing rate (what you'd pay to borrow a similar amount), or the built-in
                        implicit rate calculator if you know the asset's value. For fair value, the
                        asset's purchase price or an appraisal works.
                      </span>
                    </p>
                  )}
                </div>
              );
            })()}
            {result.classification === "other" && (
              <p className="text-sm text-muted-foreground">
                This document doesn't look like a loan or lease agreement, so there's nothing to
                prefill. You can try a different PDF.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {result?.classification === "other" && (
            <Button variant="secondary" onClick={reset}>
              Try Another PDF
            </Button>
          )}
          {!result && (
            <Button
              disabled={!selected || importDoc.isPending}
              onClick={() => {
                if (!selected) return;
                importDoc.mutate({ id: fileId, data: { file: selected } });
              }}
              className="gap-2"
            >
              {importDoc.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Reading…
                </>
              ) : (
                <>
                  <FileUp className="h-4 w-4" /> Read Document
                </>
              )}
            </Button>
          )}
          {result?.classification === "loan" && (
            <Button
              className="gap-2"
              onClick={() => {
                onUseLoan(result);
                handleOpenChange(false);
              }}
            >
              <Landmark className="h-4 w-4" /> Prefill Loan Form
            </Button>
          )}
          {result?.classification === "lease" && (
            <Button
              className="gap-2"
              onClick={() => {
                onUseLease(result);
                handleOpenChange(false);
              }}
            >
              <Receipt className="h-4 w-4" /> Start Lease Assessment
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
