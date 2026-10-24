import { serve } from "../_shared/serve.ts";
import { createClaimsHandler } from "./handler.ts";

serve((ctx) => createClaimsHandler({ auth: ctx.auth(), db: ctx.db(), config: ctx.config }));
