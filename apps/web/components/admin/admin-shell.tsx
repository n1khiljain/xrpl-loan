import type { ReactNode } from "react";
import { AccountGate } from "@/components/app/account-gate";
import { ErrorNotice } from "@/components/app/notice";
import { Topbar } from "@/components/app/topbar";
import type { MeResponse } from "@/lib/types";

/** Staff pages. Runs inside Frax's Safe UI (BRAND.md); the sidebar and tab bar already carry the admin nav. */
export function AdminShell({ title, children }: { title: string; children: (me: MeResponse) => ReactNode }) {
  return (
    <AccountGate reason="Staff sign in to review reimbursements.">
      {(me) => (
        <>
          <Topbar title={title} crumb="Admin · Frax Safe" />
          {me.staffRole ? children(me) : <ErrorNotice title="Staff only">This wallet isn&apos;t on the staff list.</ErrorNotice>}
        </>
      )}
    </AccountGate>
  );
}
