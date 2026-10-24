import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The app's one dollar field: a label, then a tall box with a large `$` and number, and Max inside it when there's a
 * most you can send. Used by the reimbursement form, cash out, and sending to Frax so all three match (U-75).
 */
export function MoneyField({
  id,
  label,
  value,
  onChange,
  placeholder,
  onMax,
  maxDisabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onMax?: () => void;
  maxDisabled?: boolean;
  hint?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-semibold">
        {label}
      </Label>
      <div className="border-input bg-surface focus-within:border-ring focus-within:ring-ring/50 flex h-16 items-center gap-1 rounded-md border pr-2.5 pl-4 focus-within:ring-[3px]">
        <span aria-hidden className="money-type text-muted-foreground text-3xl font-semibold">
          $
        </span>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="money-type h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-3xl font-semibold shadow-none focus-visible:ring-0 md:text-3xl"
        />
        {onMax ? (
          <Button type="button" variant="secondary" size="sm" onClick={onMax} disabled={maxDisabled}>
            Max
          </Button>
        ) : null}
      </div>
      {hint}
    </div>
  );
}
