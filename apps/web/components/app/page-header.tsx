import type { ReactNode } from "react";

export function PageHeader({ title, lead, action }: { title: string; lead?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="display-type text-3xl sm:text-4xl">{title}</h1>
        {lead ? <p className="text-muted-foreground mt-2 max-w-prose text-sm sm:text-base">{lead}</p> : null}
      </div>
      {action}
    </div>
  );
}
