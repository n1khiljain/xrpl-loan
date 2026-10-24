import { serve } from "../_shared/serve.ts";
import { createMeHandler } from "./handler.ts";

serve((ctx) => createMeHandler({ auth: ctx.auth(), db: ctx.db(), custody: ctx.custody(), ledger: ctx.ledger() }));
