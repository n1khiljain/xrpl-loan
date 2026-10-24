import { serve } from "../_shared/serve.ts";
import { createDirectoryHandler } from "./handler.ts";

serve((ctx) => createDirectoryHandler({ auth: ctx.auth(), db: ctx.db(), fraxnet: ctx.fraxnet() }));
