import { handle, parseId, readJson, requireUser } from "@/lib/api";
import { createAdjustment, deleteAdjustment, updateAdjustment } from "@/lib/stock-service";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  await createAdjustment(user, await readJson(req));
  return { ok: true };
});

export const PATCH = handle(async (req) => {
  const user = await requireUser(req);
  await updateAdjustment(user, await readJson(req));
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  await deleteAdjustment(user, parseId(req.nextUrl.searchParams.get("id") ?? ""));
  return { ok: true };
});
