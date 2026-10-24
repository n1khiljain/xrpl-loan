"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ErrorNotice } from "@/components/app/notice";
import { Button } from "@/components/ui/button";
import { useCall } from "@/hooks/use-api";
import { friendlyError } from "@/lib/errors";

/**
 * One staff step on a receivable (approve, reject, call the guarantor, write off), sent to `receivable-actions`. The backend
 * checks the role and the receivable's state; this only shows the button, the wait, and any refusal.
 */
export function StaffAction({
  label,
  body,
  disabled,
  variant = "default",
  testId,
}: {
  label: string;
  body: Record<string, unknown> | null;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary";
  testId?: string;
}) {
  const call = useCall();
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: () => call("receivable-actions", { method: "POST", body }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <div className="space-y-2">
      <Button variant={variant} onClick={() => action.mutate()} disabled={disabled || !body || action.isPending} data-testid={testId}>
        {action.isPending ? "Working..." : label}
      </Button>
      {action.isError ? <ErrorNotice>{friendlyError(action.error)}</ErrorNotice> : null}
    </div>
  );
}
