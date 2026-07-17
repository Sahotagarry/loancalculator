import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X, Plus } from "lucide-react";

// Curated list of security clauses. These labels are matched verbatim by the
// narrative builder in aspe-utils.ts (SECURITY_CLAUSE_PHRASES) — keep them in
// sync. "Unsecured" is handled specially by the narrative builder.
export const CURATED_SECURITY_CLAUSES: string[] = [
  "General security agreement (GSA)",
  "Specific charge / mortgage on real property (land & building)",
  "Specific charge on equipment",
  "Personal guarantee(s)",
  "Assignment of rents / leases",
  "Pledge of investments / shares",
  "Assignment of insurance",
  "Postponement / subordination of shareholder loans",
  "Corporate guarantee from a related/parent company",
  "Assignment of specific accounts receivable / contracts",
  "Pledge of cash / GIC",
  "Unsecured",
];

export interface SecurityCollateralValue {
  securityClauses: string[];
  collateralType: string;
  collateralDescription: string;
  collateralDepreciableCost: number;
  collateralLandCost: number;
  collateralInServiceDate: string;
  collateralMethod: string;
  collateralUsefulLifeYears: number;
  collateralDecliningRate: number;
  collateralSalvageValue: number;
}

export function SecurityCollateralFields({
  value,
  onChange,
}: {
  value: SecurityCollateralValue;
  onChange: (patch: Partial<SecurityCollateralValue>) => void;
}) {
  const [customClause, setCustomClause] = useState("");

  const toggleClause = (clause: string, checked: boolean) => {
    const set = new Set(value.securityClauses);
    if (checked) set.add(clause);
    else set.delete(clause);
    onChange({ securityClauses: Array.from(set) });
  };

  const addCustomClause = () => {
    const trimmed = customClause.trim();
    if (!trimmed) return;
    if (value.securityClauses.includes(trimmed)) {
      setCustomClause("");
      return;
    }
    onChange({ securityClauses: [...value.securityClauses, trimmed] });
    setCustomClause("");
  };

  const customClauses = value.securityClauses.filter(
    (c) => !CURATED_SECURITY_CLAUSES.includes(c)
  );

  const type = value.collateralType;
  const showType = type !== "";
  const showDepreciable =
    type === "equipment" || type === "building" || type === "land_and_building";
  const showLand = type === "land" || type === "land_and_building";
  const isDeclining = value.collateralMethod === "declining_balance";

  return (
    <div className="space-y-4 border rounded-lg p-4 bg-muted/20">
      <h3 className="font-display font-semibold text-sm">Security & Collateral</h3>

      <div className="space-y-2">
        <Label>Security Clauses</Label>
        <p className="text-xs text-muted-foreground">
          Select the security held. These are woven into the disclosure narrative.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          {CURATED_SECURITY_CLAUSES.map((clause) => (
            <label
              key={clause}
              className="flex items-start gap-2 text-sm cursor-pointer"
            >
              <Checkbox
                checked={value.securityClauses.includes(clause)}
                onCheckedChange={(checked) => toggleClause(clause, checked === true)}
                className="mt-0.5"
              />
              <span className="leading-tight">{clause}</span>
            </label>
          ))}
        </div>

        {customClauses.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {customClauses.map((clause) => (
              <span
                key={clause}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs text-primary"
              >
                {clause}
                <button
                  type="button"
                  onClick={() => toggleClause(clause, false)}
                  className="hover:text-primary/70"
                  aria-label={`Remove ${clause}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Input
            value={customClause}
            onChange={(e) => setCustomClause(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomClause();
              }
            }}
            placeholder="Add a custom clause…"
          />
          <Button type="button" variant="outline" onClick={addCustomClause}>
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t">
        <Label>Collateral Asset</Label>
        <p className="text-xs text-muted-foreground">
          One asset per loan. Its net book value at year end is disclosed in the
          narrative.
        </p>
        <Select
          value={type === "" ? "none" : type}
          onValueChange={(v) => {
            const newType = v === "none" ? "" : v;
            const matchingClause =
              newType === "equipment"
                ? "Specific charge on equipment"
                : newType === "building" || newType === "land" || newType === "land_and_building"
                  ? "Specific charge / mortgage on real property (land & building)"
                  : null;
            if (matchingClause && !value.securityClauses.includes(matchingClause)) {
              onChange({
                collateralType: newType,
                securityClauses: [...value.securityClauses, matchingClause],
              });
            } else {
              onChange({ collateralType: newType });
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No specific collateral</SelectItem>
            <SelectItem value="equipment">Equipment</SelectItem>
            <SelectItem value="building">Building</SelectItem>
            <SelectItem value="land">Land</SelectItem>
            <SelectItem value="land_and_building">Land &amp; Building</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {showType && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Collateral Description</Label>
            <Input
              value={value.collateralDescription}
              onChange={(e) => onChange({ collateralDescription: e.target.value })}
              placeholder="e.g. manufacturing equipment"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {showLand && (
              <div className="space-y-2">
                <Label>Land Cost ($)</Label>
                <Input
                  type="number"
                  value={value.collateralLandCost}
                  onChange={(e) =>
                    onChange({ collateralLandCost: Number(e.target.value) })
                  }
                />
              </div>
            )}
            {showDepreciable && (
              <div className="space-y-2">
                <Label>
                  {type === "land_and_building" ? "Building Cost ($)" : "Cost ($)"}
                </Label>
                <Input
                  type="number"
                  value={value.collateralDepreciableCost}
                  onChange={(e) =>
                    onChange({ collateralDepreciableCost: Number(e.target.value) })
                  }
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>In-Service Date</Label>
              <Input
                type="date"
                value={value.collateralInServiceDate}
                onChange={(e) =>
                  onChange({ collateralInServiceDate: e.target.value })
                }
              />
            </div>
            {type === "land" && (
              <div className="flex items-end">
                <p className="text-xs text-muted-foreground pb-2">
                  Land is not depreciated; its carrying value equals cost.
                </p>
              </div>
            )}
          </div>

          {showDepreciable && (
            <>
              <div className="space-y-2">
                <Label>Depreciation Method</Label>
                <Select
                  value={value.collateralMethod || "straight_line"}
                  onValueChange={(v) => onChange({ collateralMethod: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="straight_line">
                      Straight-line (cost ÷ useful life)
                    </SelectItem>
                    <SelectItem value="declining_balance">
                      Declining balance (rate %)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {isDeclining ? (
                  <div className="space-y-2">
                    <Label>Declining Balance Rate (% / year)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={value.collateralDecliningRate}
                      onChange={(e) =>
                        onChange({ collateralDecliningRate: Number(e.target.value) })
                      }
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Useful Life (years)</Label>
                    <Input
                      type="number"
                      value={value.collateralUsefulLifeYears}
                      onChange={(e) =>
                        onChange({
                          collateralUsefulLifeYears: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Salvage Value ($)</Label>
                  <Input
                    type="number"
                    value={value.collateralSalvageValue}
                    onChange={(e) =>
                      onChange({ collateralSalvageValue: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
