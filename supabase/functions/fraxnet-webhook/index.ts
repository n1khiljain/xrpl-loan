import { serve } from "../_shared/serve.ts";
import { createWebhookHandler } from "./handler.ts";

serve((ctx) => createWebhookHandler({ db: ctx.db(), secret: ctx.env.get("FRAXNET_WEBHOOK_SECRET") }));
