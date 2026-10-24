import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

// ABIs only. Addresses come from @app/config (deployments/<network>.json), never from here (FR-F11).
export default defineConfig({
  out: "src/generated.ts",
  plugins: [
    foundry({
      project: "../../contracts",
      // runs `forge build` in contracts/ first, then reads contracts/out
      forge: { build: true },
      include: [
        "ClaimRegistry.sol/**",
        "ReceivablesPool.sol/**",
        "ClaimNFT.sol/**",
        "OrgRegistry.sol/**",
        "MockFrxUSD.sol/**",
      ],
    }),
  ],
});
