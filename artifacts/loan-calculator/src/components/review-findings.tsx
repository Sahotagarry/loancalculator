import { useState } from "react";
import { AlertTriangle, Info, XCircle, CheckCircle2, X, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DiagnosticFinding, DiagnosticSeverity } from "@/lib/diagnostics";

const SEVERITY_STYLES: Record<
  DiagnosticSeverity,
  { icon: typeof Info; iconClass: string; badgeClass: string; label: string }
> = {
  error: {
    icon: XCircle,
    iconClass: "text-red-600 dark:text-red-400",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    label: "Missing",
  },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-600 dark:text-amber-400",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    label: "Incomplete",
  },
  info: {
    icon: Info,
    iconClass: "text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
    label: "Suggestion",
  },
};

export function SeverityBadge({ severity }: { severity: DiagnosticSeverity }) {
  const s = SEVERITY_STYLES[severity];
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${s.badgeClass}`}>
      {s.label}
    </span>
  );
}

interface FindingsListProps {
  findings: DiagnosticFinding[];
  dismissed?: DiagnosticFinding[];
  onDismiss?: (findingId: string) => void;
  onRestore?: (findingId: string) => void;
}

export function FindingsList({ findings, dismissed = [], onDismiss, onRestore }: FindingsListProps) {
  const [showDismissed, setShowDismissed] = useState(false);

  if (findings.length === 0 && dismissed.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        Nothing flagged — all key information is present.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {findings.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Nothing flagged — all key information is present.
        </div>
      )}
      <ul className="space-y-3">
        {findings.map((f) => {
          const s = SEVERITY_STYLES[f.severity];
          const Icon = s.icon;
          return (
            <li key={f.id} className="flex items-start gap-2.5 group">
              <Icon className={`h-4 w-4 mt-0.5 flex-shrink-0 ${s.iconClass}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{f.message}</span>
                  <SeverityBadge severity={f.severity} />
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{f.suggestion}</p>
              </div>
              {onDismiss && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-muted-foreground opacity-60 hover:opacity-100 flex-shrink-0"
                  title="Dismiss — not applicable"
                  onClick={() => onDismiss(f.id)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {dismissed.length > 0 && (
        <div className="pt-1 border-t">
          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground py-1"
            onClick={() => setShowDismissed((v) => !v)}
          >
            {showDismissed ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {dismissed.length} dismissed as not applicable
          </button>
          {showDismissed && (
            <ul className="space-y-2 mt-1">
              {dismissed.map((f) => (
                <li key={f.id} className="flex items-start gap-2.5 opacity-60">
                  <X className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm line-through">{f.message}</span>
                  </div>
                  {onRestore && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-muted-foreground flex-shrink-0"
                      title="Restore this check"
                      onClick={() => onRestore(f.id)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
