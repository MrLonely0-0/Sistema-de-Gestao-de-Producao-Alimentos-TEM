import { handle, parseId, readJson, requestToken, requireAdmin } from "@/lib/api";
import { createUser, deleteUser, updateUser } from "@/lib/account-service";

export const POST = handle(async (req) => {
  const admin = await requireAdmin(req, "admin_usuarios");
  return createUser(admin, await readJson(req));
});
export const PATCH = handle(async (req) => {
  const admin = await requireAdmin(req, "admin_usuarios");
  await updateUser(admin, await readJson(req), requestToken(req));
  return { ok: true };
});
export const DELETE = handle(async (req) => {
  const admin = await requireAdmin(req, "admin_usuarios");
  await deleteUser(admin, parseId(req.nextUrl.searchParams.get("id") ?? ""));
  return { ok: true };
});
