import type { ReactNode } from "react";
import { AccountGate } from "@/components/app/account-gate";
import { ErrorNotice } from "@/components/app/notice";
import { Topbar } from "@/components/app/topbar";
import type { MeResponse } from "@/lib/types";

/** Staff pages; the sidebar and tab bar already carry the admin nav. */
export function AdminShell({ title, children }: { title: string; children: (me: MeResponse) => ReactNode }) {
  return (
    <AccountGate reason="Staff sign in to review loans.">
      {(me) => (
        <>
          <Topbar title={title} crumb="Admin" />
          {me.staffRole ? children(me) : <ErrorNotice title="Staff only">This account isn&apos;t on the staff list.</ErrorNotice>}
        </>
      )}
    </AccountGate>
  );
}
