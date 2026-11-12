import { handle, readJson, requireAdmin } from "@/lib/api";
import { setChatTitle } from "@/lib/chat-service";

export const PATCH = handle(async (req) => {
  const user = await requireAdmin(req);
  return { title: await setChatTitle(user, await readJson(req)) };
});
