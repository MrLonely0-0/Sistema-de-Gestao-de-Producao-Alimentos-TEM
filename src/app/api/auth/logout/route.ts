import { handle, requestToken } from "@/lib/api";
import { destroySession } from "@/lib/auth";

export const POST = handle(async (req) => {
  await destroySession(requestToken(req));
  return { ok: true };
});
