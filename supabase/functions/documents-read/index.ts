import { serve } from "../_shared/serve.ts";
import { createDocumentsReadHandler } from "./handler.ts";

serve((ctx) => createDocumentsReadHandler({ auth: ctx.auth(), db: ctx.db(), storage: ctx.storage() }));
