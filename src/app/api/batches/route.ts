import { handle, readJson, requireUser } from "@/lib/api";
import { createBatch } from "@/lib/batch-service";

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  return createBatch(user, await readJson(req));
});
