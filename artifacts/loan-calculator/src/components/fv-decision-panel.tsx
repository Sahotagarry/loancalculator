import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Pencil, RotateCcw, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import { canSaveFvRate, parseFvRateInput } from "@/lib/fv-rate";
import { format } from "date-fns";

export function FvDecisionPanel({
  loan,
  file,
  isLowRate,
  isVeryLowRate,
  rate,
  fvDecisionHistory,
  confirmFvDecision,
  updateLoan,
  suggestedFvRate,
  fvDiff,
  primeData,
  readOnly
}: any) {
  const [expanded, setExpanded] = useState(false);
  const history = fvDecisionHistory;
  const current = history?.current;
  const status = history?.status || "incomplete";

  const isConfirmed = status === "current";
  const isStale = status === "stale";

  // Form state for confirmation
  const [treatment, setTreatment] = useState<string>(current?.treatment || "use_fv");
  const [marketRate, setMarketRate] = useState<string>(
    current?.marketEffectiveRate != null ? String(current.marketEffectiveRate) : 
    (loan.fvRate != null ? String(loan.fvRate) : (suggestedFvRate > 0 ? String(suggestedFvRate) : ""))
  );
  const [note, setNote] = useState<string>(current?.rationaleNote || "");
  const [confirmedBy, setConfirmedBy] = useState<string>("");

  useEffect(() => {
    if (!expanded && current) {
      setTreatment(current.treatment);
      setMarketRate(current.marketEffectiveRate != null ? String(current.marketEffectiveRate) : "");
      setNote(current.rationaleNote || "");
    }
  }, [expanded, current]);

  // Handle rate-only save logic

  if (!isLowRate && status === "incomplete") return null;

  const handleConfirm = () => {
    if (readOnly) return;
    confirmFvDecision.mutate({
      id: loan.id,
      data: {
        expectedVersion: current?.version ?? 0,
        treatment: treatment as any,
        marketEffectiveRate: treatment === "use_fv" ? Number(marketRate) : null,
        rationaleNote: treatment !== "use_fv" ? note : null,
        confirmedBy: confirmedBy || "Auditor"
      }
    });
    setExpanded(false);
  };

  const isFormValid = () => {
    if (!confirmedBy.trim()) return false;
    if (treatment === "use_fv") {
      const parsed = parseFvRateInput(marketRate);
      if (parsed == null || parsed <= 0) return false;
      if (loan.rateType === "prime_linked" && !loan.initialFvRateAssumption?.approved) {
        return false;
      }
    } else {
      if (!note.trim()) return false;
    }
    return true;
  };

  return (
    <div className={`rounded-lg border p-4 flex flex-col gap-3 ${status === "stale" ? "bg-amber-50 border-amber-200" : status === "incomplete" ? (isVeryLowRate ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200") : "bg-green-50/50 border-green-200"}`} id="fv-decision">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          {status === "current" ? (
            <CheckCircle2 className="h-5 w-5 text-green-600" />
          ) : status === "stale" ? (
            <RotateCcw className="h-5 w-5 text-amber-600" />
          ) : (
            <AlertTriangle className={`h-5 w-5 ${isVeryLowRate ? "text-red-600" : "text-amber-600"}`} />
          )}
        </div>
        <div className="space-y-2 w-full">
          <p className={`text-sm font-semibold ${status === "current" ? "text-green-900" : status === "stale" ? "text-amber-900" : isVeryLowRate ? "text-red-900" : "text-amber-900"}`}>
            {status === "current" ? "Fair Value Decision Confirmed (ASPE 3856)" : status === "stale" ? "Fair Value Assessment Stale (Review Required)" : isVeryLowRate ? "Very Low Interest Rate — ASPE 3856 Fair Value Assessment Required" : "Low Interest Rate — ASPE 3856 Fair Value Assessment May Be Required"}
          </p>
          
          {status === "stale" && history && (
            <div className="text-xs text-amber-800 space-y-1 bg-amber-100/50 p-2 rounded-md">
              <p className="font-medium">The previously confirmed assessment must be reviewed because:</p>
              <ul className="list-disc list-inside pl-4">
                {history.staleReasons.map((r: string) => <li key={r}>{r.replace(/_/g, " ")}</li>)}
              </ul>
            </div>
          )}

          {status === "incomplete" && (
            <p className={`text-xs ${isVeryLowRate ? "text-red-800" : "text-amber-800"}`}>
              The contractual rate of {rate.toFixed(2)}% is below the market threshold. ASPE 3856 requires that loans/leases with below-market rates be recorded at fair value using an imputed rate. Complete explicit confirmation below.
            </p>
          )}

          {(!isConfirmed || expanded || status === "stale") && (
            <div className="space-y-4 pt-3 border-t border-black/10 mt-3">
              <div className="space-y-3">
                <Label className="text-xs font-semibold">1. Determine Market Rate</Label>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="fv-rate-input" className="text-xs font-medium">
                      Fair value rate (%)
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="fv-rate-input"
                        type="number"
                        step="0.01"
                        min="0"
                        className="h-8 w-28 bg-white text-xs"
                        value={marketRate}
                        onChange={(e) => setMarketRate(e.target.value)}
                        disabled={readOnly}
                      />
                      {primeData?.suggestedRate != null &&
                        Number(marketRate) !== primeData.suggestedRate && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-xs"
                            disabled={readOnly}
                            onClick={() => {
                              setMarketRate(String(primeData.suggestedRate));
                            }}
                          >
                            Reset to suggested
                          </Button>
                        )}
                    </div>
                    <p className="text-[11px] text-muted-foreground max-w-lg">
                      {primeData?.suggestedRate != null
                          ? "Suggested: Bank of Canada prime at the start date + 2%. Edit to use your own market rate."
                          : "Enter the market rate to use for the fair value calculation."}
                    </p>
                  </div>
                  {fvDiff != null && (
                    <span className="text-xs font-medium pb-6">
                      FV adjustment: ${Math.abs(fvDiff).toLocaleString()} ({fvDiff >= 0 ? "higher" : "lower"})
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <Label className="text-xs font-semibold">2. Confirm Accounting Treatment</Label>
                <RadioGroup value={treatment} onValueChange={setTreatment} className="gap-3" disabled={readOnly}>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="use_fv" id="treat-use-fv" className="mt-1" />
                    <Label htmlFor="treat-use-fv" className="text-xs leading-relaxed font-normal">
                      <span className="font-semibold block">Adopt fair value</span>
                      Book this agreement using the effective-interest method at the market rate specified above.
                    </Label>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="trivial" id="treat-trivial" className="mt-1" />
                    <Label htmlFor="treat-trivial" className="text-xs leading-relaxed font-normal">
                      <span className="font-semibold block">Trivial difference (below ${file.trivialThreshold ?? "threshold"})</span>
                      The fair value difference is trivial. Book at unadjusted contractual terms.
                    </Label>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="immaterial" id="treat-immaterial" className="mt-1" />
                    <Label htmlFor="treat-immaterial" className="text-xs leading-relaxed font-normal">
                      <span className="font-semibold block">Immaterial difference (below ${file.materiality ?? "materiality"})</span>
                      The difference is immaterial but not trivial. Book at unadjusted contractual terms and track as an unadjusted misstatement.
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {treatment !== "use_fv" && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="fv-note" className="text-xs font-medium">Rationale / Notes</Label>
                  <Textarea
                    id="fv-note"
                    className="min-h-[60px] text-xs"
                    placeholder="Document why the difference is trivial or immaterial..."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={readOnly}
                  />
                </div>
              )}

              {treatment === "use_fv" && loan.rateType === "prime_linked" && !loan.initialFvRateAssumption?.approved && (
                <div className="flex items-start gap-2 rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800">
                  <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Fair value on a prime-linked agreement requires the initial expected-rate assumption to be approved. Go to the Rate Timeline tab, freeze the day-one assumptions, and explicitly approve them first.</span>
                </div>
              )}

              <div className="pt-2 flex items-end gap-3 border-t border-black/5">
                <div className="space-y-1.5 flex-1 max-w-xs">
                  <Label htmlFor="fv-confirmer" className="text-xs font-medium">Confirmed by (Initials/Name)</Label>
                  <Input 
                    id="fv-confirmer" 
                    value={confirmedBy} 
                    onChange={e => setConfirmedBy(e.target.value)} 
                    className="h-8 text-xs" 
                    placeholder="e.g. JD"
                    disabled={readOnly}
                  />
                </div>
                <div className="flex gap-2">
                  {(isConfirmed || isStale) && (
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setExpanded(false)}>
                      Cancel
                    </Button>
                  )}
                  <Button 
                    size="sm" 
                    className="h-8 text-xs" 
                    onClick={handleConfirm}
                    disabled={!isFormValid() || confirmFvDecision.isPending || readOnly}
                  >
                    {confirmFvDecision.isPending ? "Confirming..." : (isStale ? "Reconfirm Assessment" : "Confirm Assessment")}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!expanded && isConfirmed && status === "current" && current && (
            <div className="mt-2 space-y-2">
              <div className="text-xs bg-white/60 p-3 rounded border space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-green-900">
                    {current.treatment === "use_fv" ? "Fair Value Adopted" : current.treatment === "trivial" ? "Difference Assessed as Trivial" : "Difference Assessed as Immaterial"}
                  </span>
                  {!readOnly && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setExpanded(true)}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                  )}
                </div>
                {current.treatment === "use_fv" ? (
                  <p className="text-muted-foreground">Booked using the effective-interest method at {current.marketEffectiveRate}% market rate.</p>
                ) : (
                  <p className="text-muted-foreground">Booked at contractual terms. Rationale: {current.rationaleNote}</p>
                )}
                <div className="pt-1 text-[11px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Confirmed by {current.confirmedBy} on {format(new Date(current.confirmedAt), "MMM d, yyyy h:mm a")}
                </div>
              </div>
            </div>
          )}
          
          {history && history.history.length > (status === "current" ? 1 : 0) && !expanded && (
             <div className="mt-2 pt-2 border-t border-black/5">
                <p className="text-[11px] text-muted-foreground font-medium">Prior confirmations:</p>
                <div className="space-y-1 mt-1">
                  {history.history.filter((h: any) => h.id !== current?.id).map((h: any) => (
                    <div key={h.id} className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                      <span className="shrink-0">•</span>
                      <span>v{h.version} — {h.treatment.replace("_", " ")} ({h.confirmedBy}, {format(new Date(h.confirmedAt), "MMM d, yyyy")})</span>
                    </div>
                  ))}
                </div>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
