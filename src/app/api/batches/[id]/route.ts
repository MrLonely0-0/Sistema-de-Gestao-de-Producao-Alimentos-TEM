import { ApiError, handle, parseId, readJson, requireUser } from "@/lib/api";
import { deleteBatch, updateBatch } from "@/lib/batch-service";
import { getBatchDetail } from "@/lib/queries";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (req, { params }) => {
  await requireUser(req);
  const detail = await getBatchDetail(parseId((await params).id));
  if (!detail) throw new ApiError(404, "Batelada não encontrada.");
  return detail;
});

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  await updateBatch(user, parseId((await params).id), await readJson(req));
  return { ok: true };
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  await deleteBatch(user, parseId((await params).id));
  return { ok: true };
});
