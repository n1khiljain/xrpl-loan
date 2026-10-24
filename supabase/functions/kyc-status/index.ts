import { serve } from "../_shared/serve.ts";
import { createKycStatusHandler } from "./handler.ts";

serve((ctx) =>
  createKycStatusHandler({ auth: ctx.auth(), db: ctx.db(), fraxnet: ctx.fraxnet(), walletChainId: ctx.config.fraxnet.walletChainId }),
);
