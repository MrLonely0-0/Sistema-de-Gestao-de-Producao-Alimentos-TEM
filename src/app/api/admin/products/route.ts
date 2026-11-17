import { handle, parseId, readJson, requireAdmin } from "@/lib/api";
import { createProduct, deleteProduct, updateProduct } from "@/lib/admin-service";

export const POST = handle(async (req) => {
  const user = await requireAdmin(req, "admin_produtos");
  return createProduct(user, await readJson(req));
});

export const PATCH = handle(async (req) => {
  const user = await requireAdmin(req, "admin_produtos");
  await updateProduct(user, await readJson(req));
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const user = await requireAdmin(req, "admin_produtos");
  await deleteProduct(user, parseId(req.nextUrl.searchParams.get("id") ?? ""));
  return { ok: true };
});
