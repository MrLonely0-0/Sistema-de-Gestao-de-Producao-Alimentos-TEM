import { handle, parseId, readJson, requireAdmin } from "@/lib/api";
import { createColumn, deleteColumn, reorderColumns, updateColumn } from "@/lib/column-service";

export const POST = handle(async (req) => {
  const user = await requireAdmin(req, "admin_paineis");
  return createColumn(user, await readJson(req));
});

export const PATCH = handle(async (req) => {
  const user = await requireAdmin(req, "admin_paineis");
  const body = await readJson(req);
  if (body && typeof body === "object" && "order" in body) {
    await reorderColumns(user, body);
  } else {
    await updateColumn(user, body);
  }
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const user = await requireAdmin(req, "admin_paineis");
  await deleteColumn(user, parseId(req.nextUrl.searchParams.get("id") ?? ""));
  return { ok: true };
});
