import { serve } from "../_shared/serve.ts";
import { createDocumentsHandler } from "./handler.ts";

serve((ctx) => createDocumentsHandler({ auth: ctx.auth(), db: ctx.db(), storage: ctx.storage() }));
