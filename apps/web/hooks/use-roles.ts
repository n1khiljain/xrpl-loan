"use client";

import { claimRegistryAbi, receivablesPoolAbi } from "@app/abi";
import { useQuery } from "@tanstack/react-query";
import { type Address, zeroHash } from "viem";
import { publicClient } from "@/lib/chain";
import { config, deployedContracts } from "@/lib/config";
import { useSession } from "@/lib/session/context";

export type RoleName = "underwriter" | "attester" | "admin";

/** The Safe that holds a role, from the network config; null while it's still the placeholder. */
export function roleSafe(role: RoleName): Address | null {
  const value = config.roles[role];
  return /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

/** Whether the connected wallet holds the role onchain itself (true on local, where the deployer holds them). */
export function useHoldsRole(role: RoleName) {
  const session = useSession();
  const deployed = deployedContracts();
  return useQuery({
    queryKey: ["holds-role", role, session.address],
    enabled: Boolean(session.address && deployed),
    queryFn: async () => {
      const registry = { address: deployed!.claimRegistry, abi: claimRegistryAbi } as const;
      const id =
        role === "admin"
          ? zeroHash
          : await publicClient.readContract({ ...registry, functionName: role === "underwriter" ? "UNDERWRITER_ROLE" : "ATTESTER_ROLE" });
      const onRegistry = await publicClient.readContract({ ...registry, functionName: "hasRole", args: [id, session.address!] });
      if (role !== "admin") return onRegistry;
      const onPool = await publicClient.readContract({
        address: deployed!.pool,
        abi: receivablesPoolAbi,
        functionName: "hasRole",
        args: [zeroHash, session.address!],
      });
      return onRegistry && onPool;
    },
  });
}
