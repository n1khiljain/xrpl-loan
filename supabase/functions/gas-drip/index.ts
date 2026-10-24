import { serve } from "../_shared/serve.ts";
import { createGasDripHandler } from "./handler.ts";

serve((ctx) =>
  createGasDripHandler({ auth: ctx.auth(), db: ctx.db(), sponsor: ctx.gasSponsor(), amountWei: ctx.dripAmountWei() })
);
