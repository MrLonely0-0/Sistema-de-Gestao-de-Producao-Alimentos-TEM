import { handle, readJson, requestToken, requireUser } from "@/lib/api";
import { saveMyProfile } from "@/lib/account-service";

export const dynamic = "force-dynamic";
export const GET = handle(async (req) => ({ user: await requireUser(req) }));
export const PATCH = handle(async (req) => {
  const user = await requireUser(req);
  return saveMyProfile(user, await readJson(req), requestToken(req));
});
