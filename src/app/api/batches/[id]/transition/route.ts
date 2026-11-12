import { handle, parseId, readJson, requireUser } from "@/lib/api";
import { transitionBatch } from "@/lib/batch-service";

type Ctx = { params: Promise<{ id: string }> };

// A permissão por ação (quem pode liberar, reter, finalizar…) é checada no serviço.
export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  await transitionBatch(user, parseId((await params).id), await readJson(req));
  return { ok: true };
});
