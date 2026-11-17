import { handle, parseId, readJson, requireAdmin } from "@/lib/api";
import { createProfile, deleteProfile, updateProfile } from "@/lib/profile-service";

export const POST = handle(async (req) => {
  const u = await requireAdmin(req, "admin_perfis");
  return createProfile(u, await readJson(req));
});
export const PATCH = handle(async (req) => {
  const u = await requireAdmin(req, "admin_perfis");
  await updateProfile(u, await readJson(req));
  return { ok: true };
});
export const DELETE = handle(async (req) => {
  const u = await requireAdmin(req, "admin_perfis");
  return deleteProfile(u, parseId(req.nextUrl.searchParams.get("id") ?? ""), req.nextUrl.searchParams.get("replacementRole"));
});
