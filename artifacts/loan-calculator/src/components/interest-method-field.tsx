import { DEFAULT_LOAN_INTEREST_METHOD, INTEREST_METHODS, interestMethods, type InterestMethod } from '@workspace/amortization';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

export function InterestMethodField({value, onChange, note}: {value: InterestMethod; onChange: (method: InterestMethod) => void; note?: string}) {
  return <div className="space-y-2">
    <Label htmlFor="interest-method">How is interest calculated?</Label>
    <Select value={value} onValueChange={v => onChange(v as InterestMethod)}>
      <SelectTrigger id="interest-method" aria-describedby="interest-method-help"><SelectValue /></SelectTrigger>
      <SelectContent>{INTEREST_METHODS.map(m => <SelectItem key={m} value={m}>{interestMethods[m].label}{m === DEFAULT_LOAN_INTEREST_METHOD ? ' (new loan default)' : ''}</SelectItem>)}</SelectContent>
    </Select>
    <p id="interest-method-help" className="text-xs text-muted-foreground">{interestMethods[value].hint}</p>
    {note && <p className="text-xs text-muted-foreground border-l-2 pl-2">{note}</p>}
  </div>;
}
