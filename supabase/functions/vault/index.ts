import { serve } from "../_shared/serve.ts";
import { createVaultHandler } from "./handler.ts";

serve((ctx) =>
  createVaultHandler({
    auth: ctx.auth(),
    db: ctx.db(),
    ledger: ctx.ledger(),
    custody: ctx.custody(),
    config: ctx.config,
    env: ctx.env,
  }),
);
