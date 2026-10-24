import { serve } from "../_shared/serve.ts";
import { createSimulatePayoutHandler } from "./handler.ts";

serve((ctx) =>
  createSimulatePayoutHandler({
    auth: ctx.auth(),
    db: ctx.db(),
    config: ctx.config,
    chain: ctx.chain(),
    registry: ctx.registry(),
    payout: () => ctx.payout(),
  })
);
