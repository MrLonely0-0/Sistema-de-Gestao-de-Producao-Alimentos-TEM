import { handle, readJson, requireAdmin } from "@/lib/api";
import { createInventoryItem, deleteInventoryItem, updateInventoryItem } from "@/lib/inventory-service";

export const POST = handle(async (req) => {
  const user = await requireAdmin(req, "estoque_itens");
  return createInventoryItem(user, await readJson(req));
});

export const PATCH = handle(async (req) => {
  const user = await requireAdmin(req, "estoque_itens");
  await updateInventoryItem(user, await readJson(req));
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const user = await requireAdmin(req, "estoque_itens");
  await deleteInventoryItem(user, await readJson(req));
  return { ok: true };
});
