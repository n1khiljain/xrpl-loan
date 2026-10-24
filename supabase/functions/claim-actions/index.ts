import { serve } from "../_shared/serve.ts";
import { createClaimActionsHandler } from "./handler.ts";

serve((ctx) =>
  createClaimActionsHandler({ auth: ctx.auth(), db: ctx.db(), config: ctx.config, mailer: ctx.mailer(), appBaseUrl: ctx.appBaseUrl })
);
