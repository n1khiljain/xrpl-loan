import { serve } from "../_shared/serve.ts";
import { createInviteHandler } from "./handler.ts";

serve((ctx) =>
  createInviteHandler({
    auth: ctx.auth(),
    db: ctx.db(),
    config: ctx.config,
    registry: ctx.registry(),
    mailer: ctx.mailer(),
    appBaseUrl: ctx.appBaseUrl,
  })
);
