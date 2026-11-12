import { handle, parseId, readJson, requireUser } from "@/lib/api";
import { deleteShipment, updateShipment } from "@/lib/stock-service";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  await updateShipment(user, { id: parseId((await params).id), ...((await readJson(req)) as object) });
  return { ok: true };
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  await deleteShipment(user, parseId((await params).id));
  return { ok: true };
});
