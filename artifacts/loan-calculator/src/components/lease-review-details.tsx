import type { ReactNode } from "react";

/** Native disclosure supports Enter/Space and retains all inputs in the tab order when open. */
export function LeaseReviewDetails({ title, needsAttention, children }: {
  title: string;
  needsAttention?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={needsAttention || undefined} className="rounded-lg border p-3">
      <summary className="cursor-pointer rounded text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {title}{needsAttention ? " — review needed" : ""}
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}
