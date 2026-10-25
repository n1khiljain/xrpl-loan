import { isSetUp } from "@app/config";
import { serve } from "../_shared/serve.ts";
import { ensureAccess } from "../_shared/lending.ts";
import { createKycManualHandler } from "./handler.ts";

serve((ctx) =>
  createKycManualHandler({
    auth: ctx.auth(),
    db: ctx.db(),
    issueCredential: async (wallet) => {
      if (!isSetUp(ctx.config)) return;
      const seed = ctx.env.get("BROKER_SEED");
      if (!seed) return;
      await ensureAccess({ ledger: ctx.ledger(), custody: ctx.custody(), config: ctx.config, brokerSeed: seed, holder: wallet });
    },
  }),
);
