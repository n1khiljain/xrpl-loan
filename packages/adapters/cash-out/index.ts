import type { NetworkConfig } from "@app/config";
import type { Address, PublicClient } from "viem";
import { publicClientFor } from "../shared/chain.ts";
import { AdapterConfigError } from "../shared/errors.ts";
import { createMeshCashOut } from "./mesh.ts";
import { createSimulatedCashOut } from "./simulated.ts";
import type { CashOut } from "./types.ts";

export * from "./types.ts";
export * from "./simulated.ts";
export * from "./mesh.ts";
export * from "./oft.ts";

export type CashOutDeps = { publicClient?: PublicClient };

/** The token the pool holds: the deployed one (MockFrxUSD on local), else the configured frxUSD. */
export function frxUsdAddress(config: NetworkConfig): Address {
  const address = config.deployed.frxUSD ?? config.frxUSD;
  if (!address) throw new AdapterConfigError("CashOut", `no frxUSD address for ${config.network}; deploy first`);
  return address;
}

/** Picks the implementation named by `config.adapters.cashOut` (FR-A1). */
export function createCashOut(config: NetworkConfig, deps: CashOutDeps = {}): CashOut {
  switch (config.adapters.cashOut) {
    case "simulated": {
      if (config.cashOutSink === null) throw new AdapterConfigError("CashOut", "'simulated' needs cashOutSink");
      return createSimulatedCashOut({ frxUSD: frxUsdAddress(config), sink: config.cashOutSink });
    }
    case "mesh": {
      if (config.fraxMesh === null) throw new AdapterConfigError("CashOut", "'mesh' needs fraxMesh (U-17)");
      return createMeshCashOut({
        publicClient: deps.publicClient ?? publicClientFor(config),
        oft: config.fraxMesh,
        frxUSD: frxUsdAddress(config),
      });
    }
  }
}
