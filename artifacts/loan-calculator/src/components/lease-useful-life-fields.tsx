import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSET_TYPE_LIVES, ASSET_TYPE_OPTIONS, type UsefulLifeSource } from "@/lib/lease-useful-life";

export function LeaseUsefulLifeFields({ years, source, assetType, reasoning, readOnly, onChange, onCategory }: {
  years: number; source: UsefulLifeSource; assetType: string; reasoning?: string | null; readOnly?: boolean;
  onChange: (years: number) => void; onCategory: (category: string) => void;
}) {
  return <fieldset disabled={readOnly} className="space-y-2 min-w-0" data-testid="lease-useful-life-fields">
    <Label htmlFor="economicLife">Expected useful life (years)</Label>
    <Input id="economicLife" type="number" min={0.5} step="any" value={years || ""}
      onChange={e => onChange(Number(e.target.value))} placeholder="Enter expected working life" />
    <p className="text-xs text-muted-foreground" data-testid="useful-life-source">
      {source === "asset_specific" ? "Suggested for this asset — not stated in the agreement. Confirm or change."
        : source === "category" ? "Standard category suggestion — confirm or change for this asset."
        : source === "existing" ? "Documented or previously entered value retained. Change it only if needed."
        : years > 0 ? "Your override." : "Enter the asset's expected useful life."}
      {" "}Assess the asset's economic working life at lease start, not the lease term or the client's planned holding period.
    </p>
    {source === "asset_specific" && reasoning && <details className="text-xs" data-testid="useful-life-reason">
      <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Why this suggestion?</summary>
      <p className="mt-2 whitespace-pre-line text-muted-foreground">{reasoning}</p>
    </details>}
    <details className="rounded-lg border px-3 py-2 text-sm" data-testid="useful-life-category-picker">
      <summary className="cursor-pointer rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Use a standard category instead</summary>
      <div className="mt-3 space-y-2">
        <Label htmlFor="usefulLifeCategory">Standard useful-life category</Label>
        <select id="usefulLifeCategory" className="block w-full min-w-0 rounded-md border bg-background p-2 text-sm"
          value={source === "category" ? assetType : ""}
          onChange={e => onCategory(e.target.value)}>
          <option value="" disabled>Choose a category to apply its standard life</option>
          {ASSET_TYPE_OPTIONS.filter(([key]) => ASSET_TYPE_LIVES[key] > 0 || key === "other").map(([key, label]) =>
            <option key={key} value={key}>{label}</option>)}
        </select>
        <p className="text-xs text-muted-foreground">Choosing a category replaces the useful life above with its standard. You can then type an override.</p>
      </div>
    </details>
  </fieldset>;
}
