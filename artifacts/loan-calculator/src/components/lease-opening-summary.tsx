import type { LeaseEndingTerms } from "@workspace/amortization";
import { formatCurrency } from "@/lib/format";

export function leaseEndingSummary(ending?: LeaseEndingTerms | null): string {
  const amount = ending?.amount == null ? "the supported amount" : formatCurrency(ending.amount);
  switch (ending?.kind) {
    case "guaranteed_residual": return `The client pays the difference if the sale proceeds are below ${amount}. The guarantee is included once, not as a purchase or a separate payment of the full guaranteed amount.`;
    case "mandatory_payment": return `The client must pay ${amount} at the end of the lease. This required payment is included once.`;
    case "bargain_purchase": return `The supported bargain purchase payment of ${amount} is included in the calculation.`;
    case "optional_purchase": return "The client can choose whether to buy the asset. The optional purchase price is not included as an amount the client must pay.";
    case "lessor_residual": return "The owner keeps the risk of the asset’s ending value. That value is not included as an amount the client must pay.";
    case "none": return "There is no separate ending payment or sale shortfall guarantee.";
    default: return "The ending obligation has not been established. Review the agreement and document what the client must pay.";
  }
}

export function LeaseOpeningSummary({ pvValue, fairValue, downPayment, ending, classificationChanged }: {
  pvValue: number; fairValue: number; downPayment: number;
  ending?: LeaseEndingTerms | null; classificationChanged: boolean;
}) {
  const ready = !classificationChanged && (!ending || ending.status === "reviewed") && pvValue > 0 && fairValue > 0;
  const asset = Math.min(pvValue, fairValue);
  return (
    <>
      <section aria-label="Opening amounts to record" className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <h3 className="font-semibold">Opening amounts to record</h3>
        {ready ? <>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div><dt className="text-sm text-muted-foreground">Leased asset</dt><dd className="text-xl font-semibold tabular-nums">{formatCurrency(asset)}</dd></div>
            <div><dt className="text-sm text-muted-foreground">Lease obligation</dt><dd className="text-xl font-semibold tabular-nums">{formatCurrency(asset - downPayment)}</dd></div>
          </dl>
          <p className="text-sm">The obligation is <strong>before the first rent</strong> and <strong>after any separate upfront payment</strong>{downPayment > 0 ? ` of ${formatCurrency(downPayment)}` : ""}. Do not deduct that upfront payment again.</p>
          <p className="text-xs text-muted-foreground">The first rent is still in the payment schedule{downPayment > 0 ? "; the separate upfront payment is already included in the asset amount" : ""}. A refundable deposit is separate, not an upfront payment toward the asset.</p>
        </> : <p role="alert" className="text-sm text-amber-900">
          {classificationChanged ? "Inputs changed. Go back and confirm the classification before using opening amounts." :
            "Draft — opening amounts are not ready to record. Review the ending evidence, payments, supported rate and fair value below."}
        </p>}
      </section>
      <section aria-label="What happens at the end" className="space-y-1 text-sm">
        <h3 className="font-semibold">What happens at the end?</h3>
        <p>{leaseEndingSummary(ending)}</p>
      </section>
    </>
  );
}
