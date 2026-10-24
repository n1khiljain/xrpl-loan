import { serve } from "../_shared/serve.ts";
import { createFraxnetConnectHandler } from "./handler.ts";

serve((ctx) =>
  createFraxnetConnectHandler({
    auth: ctx.auth(),
    db: ctx.db(),
    fraxnet: ctx.fraxnet(),
    appBaseUrl: ctx.appBaseUrl,
    walletChainId: ctx.config.fraxnet.walletChainId,
  }),
);
