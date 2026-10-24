import { serve } from "../_shared/serve.ts";
import { createNftMetadataHandler } from "./handler.ts";

serve((ctx) => createNftMetadataHandler({ chain: ctx.chain(), db: ctx.db() }));
