import { serve } from "../_shared/serve.ts";
import { createReceivableActionsHandler } from "./handler.ts";

serve((ctx) =>
  createReceivableActionsHandler({ auth: ctx.auth(), db: ctx.db(), config: ctx.config, mailer: ctx.mailer(), appBaseUrl: ctx.appBaseUrl })
);
