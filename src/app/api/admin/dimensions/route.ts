import { handle, parseId, readJson, requireAdmin } from "@/lib/api";
import { createDimension, deleteDimension, updateDimension } from "@/lib/admin-service";

export const POST = handle(async (req) => {
  const user = await requireAdmin(req);
  return createDimension(user, await readJson(req));
});

export const PATCH = handle(async (req) => {
  const user = await requireAdmin(req);
  await updateDimension(user, await readJson(req));
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const user = await requireAdmin(req);
  await deleteDimension(user, parseId(req.nextUrl.searchParams.get("id") ?? ""));
  return { ok: true };
});
