"use client";

import { useQuery } from "@tanstack/react-query";
import { callFunction } from "@/lib/api";
import { useSession } from "@/lib/session/context";
import type { DirectoryOrg, MeResponse } from "@/lib/types";

/** A function call bound to the signed-in user's Privy token. */
export function useCall() {
  const session = useSession();
  return async <T,>(name: string, options: Parameters<typeof callFunction>[1] = {}) =>
    callFunction<T>(name, { ...options, token: await session.getAccessToken() });
}

export function useMe() {
  const session = useSession();
  const call = useCall();
  return useQuery({
    queryKey: ["me", session.userId],
    enabled: session.status === "signed-in",
    queryFn: () => call<MeResponse>("me"),
  });
}

export function useOrgs() {
  const session = useSession();
  const call = useCall();
  return useQuery({
    queryKey: ["directory", "orgs"],
    enabled: session.status === "signed-in",
    queryFn: async () => (await call<{ orgs: DirectoryOrg[] }>("directory", { query: { view: "orgs" } })).orgs,
  });
}
