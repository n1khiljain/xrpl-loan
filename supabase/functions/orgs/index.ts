import { serve } from "../_shared/serve.ts";
import { createOrgsHandler } from "./handler.ts";

serve((ctx) => createOrgsHandler({ auth: ctx.auth(), db: ctx.db() }));
