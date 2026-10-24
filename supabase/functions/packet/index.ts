import { serve } from "../_shared/serve.ts";
import { createPacketHandler } from "./handler.ts";

serve((ctx) => createPacketHandler({ auth: ctx.auth(), db: ctx.db(), config: ctx.config, registry: ctx.registry() }));
