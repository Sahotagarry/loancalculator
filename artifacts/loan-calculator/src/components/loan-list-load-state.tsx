import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A failed request must never look like a successfully loaded, empty Year-End File. */
export function LoanListLoadState({ loading, failed, refreshing, hasData, onRetry }: {
  loading: boolean; failed: boolean; refreshing: boolean; hasData: boolean; onRetry: () => void;
}) {
  if (failed) return <div role="alert" className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950 space-y-2" data-testid="loan-list-error">
    <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" />
      {hasData ? "Loans and leases could not be refreshed" : "Loans and leases could not be loaded"}
    </p>
    <p>{hasData ? "The previously loaded list may be out of date." : "The application could not retrieve the records for this Year-End File. This is not confirmation that there are no saved loans or leases."}</p>
    <p>Do not recreate an existing loan or lease to resolve this message.</p>
    <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={refreshing}>
      {refreshing && <Loader2 className="h-4 w-4 animate-spin" />}{refreshing ? "Retrying…" : "Retry loading loans and leases"}
    </Button>
  </div>;
  if (loading && !hasData) return <p role="status" className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground" data-testid="loan-list-loading">
    <Loader2 className="h-4 w-4 animate-spin" />Loading loans and leases…
  </p>;
  return null;
}
