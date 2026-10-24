import { serve } from "../_shared/serve.ts";
import { createReceivablesHandler } from "./handler.ts";

serve((ctx) => createReceivablesHandler({ auth: ctx.auth(), db: ctx.db(), config: ctx.config }));
