import { handleApi } from "../../server/api";
import type { PagesContext } from "../../server/env";

/** Every `/api/*` request lands here. All logic lives in `server/` so it can be tested without workerd. */
export const onRequest = (context: PagesContext): Promise<Response> =>
  handleApi(context.request, context.env);
