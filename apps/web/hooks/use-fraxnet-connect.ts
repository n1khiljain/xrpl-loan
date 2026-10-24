"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useCall } from "@/hooks/use-api";
import { onConnected, openFraxnetTab, startFraxnetConnect } from "@/lib/fraxnet-connect";
import { useSession } from "@/lib/session/context";
import type { KycStatusResponse } from "@/lib/types";

export type ConnectState = "idle" | "opening" | "waiting";

/**
 * The Connect FraxNet button's behavior (U-77): FraxNet opens in a new tab, this page says to finish there, and it
 * updates when that tab connects (or, as a fallback, when this tab is focused again).
 */
export function useFraxnetConnect() {
  const call = useCall();
  const session = useSession();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectState>("idle");
  const [error, setError] = useState<unknown>(null);

  useEffect(
    () =>
      onConnected((status) => {
        queryClient.setQueryData(["kyc", session.userId], status as KycStatusResponse);
        void queryClient.invalidateQueries({ queryKey: ["me"] });
        setState("idle");
      }),
    [queryClient, session.userId],
  );

  useEffect(() => {
    if (state !== "waiting") return;
    const recheck = () => {
      void queryClient.invalidateQueries({ queryKey: ["kyc"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    };
    window.addEventListener("focus", recheck);
    return () => window.removeEventListener("focus", recheck);
  }, [state, queryClient]);

  function start() {
    setError(null);
    setState("opening");
    const tab = openFraxnetTab();
    startFraxnetConnect(call, `${window.location.pathname}${window.location.search}`, tab)
      .then((where) => setState(where === "tab" ? "waiting" : "opening"))
      .catch((e: unknown) => {
        tab?.close();
        setState("idle");
        setError(e);
      });
  }

  return { start, state, error };
}
