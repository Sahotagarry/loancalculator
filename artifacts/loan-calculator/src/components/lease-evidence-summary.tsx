import { leaseEndingTreatmentLabel, type LeaseEndingTerms } from "@workspace/amortization";
import { formatCurrency } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";

const fmtRate = (r: number) => Number(r.toFixed(5)).toString();

/** Read-only recap. Editing returns to the criterion that collects the evidence. */
export function LeaseEvidenceSummary({ ending, months, rate, onEdit }: {
  ending?: LeaseEndingTerms | null; months: number; rate?: number | null; onEdit?: () => void;
}) {
  const rows: Array<[string, string]> = ending ? [
    ["Ending", `${leaseEndingTreatmentLabel(ending.kind)}${ending.amount != null ? ` · ${formatCurrency(ending.amount)}` : ""}`],
    ["Settlement", `${ending.settlementMonth ?? months} months`],
    ["Taxes", ending.taxTreatment ? { excluded: "Excluded", recoverable: `Recoverable${ending.taxRate ? ` ${ending.taxRate}%` : ""}`, nonrecoverable: "Non-recoverable included", unresolved: "Not established" }[ending.taxTreatment] ?? ending.taxTreatment : "Not answered"],
    ...(ending.commencement ? [["Start date", `${ending.commencement.date || "—"}${ending.commencement.confirmed ? " · confirmed" : " · not confirmed"}`] as [string, string]] : []),
    ...(rate != null ? [["Discount rate", `${fmtRate(rate)}%`] as [string, string]] : []),
    ["Evidence", ending.status === "reviewed" && !ending.issues.length ? "Reviewed" : "Draft — needs review"],
  ] : [["Ending", "Previous ending treatment retained"], ...(rate != null ? [["Discount rate", `${fmtRate(rate)}%`] as [string, string]] : [])];
  return <section className="rounded-lg border bg-muted/20 p-3 text-sm" data-testid="lease-evidence-summary" aria-label="Classification evidence">
    <div className="mb-2 flex items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Classification evidence</p>
      {onEdit && <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={onEdit} data-testid="button-edit-classification"><Pencil className="h-3.5 w-3.5" />Edit classification</Button>}
    </div>
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="min-w-0 break-words font-medium">{v}</dd></div>)}
    </dl>
  </section>;
}
