"use client";

import { useMutation } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useCall } from "@/hooks/use-api";
import { storageUrl } from "@/lib/api";

/** Opens one receipt through a five-minute signed URL (FR-B3). */
export function ReceiptLink({ documentId, index }: { documentId: string; index: number }) {
  const call = useCall();
  const open = useMutation({
    mutationFn: async () => {
      const { signedPath } = await call<{ signedPath: string }>("documents-read", { method: "POST", body: { documentId } });
      window.open(storageUrl(signedPath), "_blank", "noopener,noreferrer");
    },
  });
  return (
    <button
      type="button"
      onClick={() => open.mutate()}
      disabled={open.isPending}
      className="border-border bg-surface-muted text-foreground hover:bg-divider outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 flex h-[84px] w-[104px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-md border text-[11px] font-semibold disabled:opacity-50"
    >
      <FileText className="text-muted-foreground size-5" strokeWidth={1.6} />
      <span>
        Receipt {index + 1}
        {open.isError ? " (couldn't open)" : ""}
      </span>
    </button>
  );
}
