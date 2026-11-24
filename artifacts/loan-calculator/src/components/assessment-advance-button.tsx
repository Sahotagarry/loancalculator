import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Button>, "disabled"> & { reasons: string[] };

/** Disabled buttons cannot receive focus or pointer events; their wrapper can. */
export function AssessmentAdvanceButton({ reasons, className, children, ...props }: Props) {
  const button = <Button {...props} disabled={reasons.length > 0}
    className={cn("min-h-11 h-auto whitespace-normal py-2 gap-2", className)}>{children}</Button>;
  if (!reasons.length) return button;
  return <Tooltip>
    <TooltipTrigger asChild>
      <span tabIndex={0} role="group" aria-label={`Cannot continue: ${reasons.join(" ")}`}
        className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {button}
      </span>
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-sm whitespace-normal p-3 text-left">
      <p className="font-semibold">To continue:</p>
      <ul className="mt-1 list-disc space-y-1 pl-4">
        {reasons.map(reason => <li key={reason}>{reason}</li>)}
      </ul>
    </TooltipContent>
  </Tooltip>;
}
