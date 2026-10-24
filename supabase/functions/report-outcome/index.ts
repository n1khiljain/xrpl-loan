import { serve } from "../_shared/serve.ts";
import { createReportOutcomeHandler } from "./handler.ts";

serve((ctx) => createReportOutcomeHandler({ auth: ctx.auth(), db: ctx.db(), chain: ctx.chain() }));
