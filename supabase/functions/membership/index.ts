import { serve } from "../_shared/serve.ts";
import { createMembershipHandler } from "./handler.ts";

serve((ctx) => createMembershipHandler({ auth: ctx.auth(), db: ctx.db() }));
