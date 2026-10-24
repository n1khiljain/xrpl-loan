import { serve } from "../_shared/serve.ts";
import { createGuarantyHandler } from "./handler.ts";

serve((ctx) =>
  createGuarantyHandler({
    auth: ctx.auth(),
    db: ctx.db(),
    config: ctx.config,
    registry: ctx.registry(),
    verifySignature: ctx.signatureCheck(),
  })
);
