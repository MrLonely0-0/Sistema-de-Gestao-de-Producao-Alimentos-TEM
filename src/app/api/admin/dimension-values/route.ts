import { handle, parseId, readJson, requireAdmin } from "@/lib/api";
import { createValue, deleteValue, updateValue } from "@/lib/admin-service";

export const POST = handle(async (req) => {
  const user = await requireAdmin(req, "admin_produtos");
  await createValue(user, await readJson(req));
  return { ok: true };
});

export const PATCH = handle(async (req) => {
  const user = await requireAdmin(req, "admin_produtos");
  await updateValue(user, await readJson(req));
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const user = await requireAdmin(req, "admin_produtos");
  await deleteValue(user, parseId(req.nextUrl.searchParams.get("id") ?? ""));
  return { ok: true };
});
