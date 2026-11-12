import { handle, parseId, readJson, requireUser } from "@/lib/api";
import { addAttachment, removeAttachment } from "@/lib/batch-service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  await addAttachment(user, parseId((await params).id), await readJson(req));
  return { ok: true };
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const attachmentId = parseId(req.nextUrl.searchParams.get("attachmentId") ?? "");
  await removeAttachment(user, parseId((await params).id), attachmentId);
  return { ok: true };
});
