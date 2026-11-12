import { handle, parseId, readJson, requireAdmin } from "@/lib/api";
import { createProfile, deleteProfile, updateProfile } from "@/lib/profile-service";

export const POST = handle(async (req) => {
  const user = await requireAdmin(req);
  return createProfile(user, await readJson(req));
});

export const PATCH = handle(async (req) => {
  const user = await requireAdmin(req);
  await updateProfile(user, await readJson(req));
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const user = await requireAdmin(req);
  await deleteProfile(user, parseId(req.nextUrl.searchParams.get("id") ?? ""));
  return { ok: true };
});
