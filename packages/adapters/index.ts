/**
 * Adapters for everything outside our contracts (SYSTEM_DESIGN section 4). App code imports the interfaces and
 * `create*` factories from here; the network config's `adapters` block picks the implementation (FR-A1, FR-A2).
 */
export * from "./shared/errors.ts";
export * from "./shared/claims.ts";
export { bindingMessage } from "./shared/binding.ts";
export { MULTICALL3, chainFromConfig, publicClientFor, type Fetch } from "./shared/chain.ts";
export * from "./fraxnet/index.ts";
export * from "./gas-sponsor/index.ts";
export * from "./cash-out/index.ts";
export * from "./chain-reader/index.ts";
