import { serve } from "../_shared/serve.ts";
import { createLoansHandler } from "./handler.ts";

serve((ctx) =>
  createLoansHandler({
    auth: ctx.auth(),
    db: ctx.db(),
    ledger: ctx.ledger(),
    custody: ctx.custody(),
    config: ctx.config,
    env: ctx.env,
  }),
);
