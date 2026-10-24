import { serve } from "../_shared/serve.ts";
import { createKycManualHandler } from "./handler.ts";

serve((ctx) => createKycManualHandler({ auth: ctx.auth(), db: ctx.db() }));
