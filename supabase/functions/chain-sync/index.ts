import { serve } from "../_shared/serve.ts";
import { createChainSyncHandler } from "./handler.ts";

serve((ctx) =>
  createChainSyncHandler({
    auth: ctx.auth(),
    db: ctx.db(),
    chain: ctx.chain(),
    mailer: ctx.mailer(),
    config: ctx.config,
    appBaseUrl: ctx.appBaseUrl,
    cronSecret: ctx.env.get("CHAIN_SYNC_SECRET"),
  })
);
