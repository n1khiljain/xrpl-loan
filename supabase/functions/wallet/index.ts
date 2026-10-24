import { serve } from "../_shared/serve.ts";
import { createWalletHandler } from "./handler.ts";

serve((ctx) => createWalletHandler({ auth: ctx.auth(), db: ctx.db(), ledger: ctx.ledger(), config: ctx.config }));
