import { handle, readJson, requireUser } from "@/lib/api";
import { createShipment } from "@/lib/batch-service";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  await createShipment(user, await readJson(req));
  return { ok: true };
});
