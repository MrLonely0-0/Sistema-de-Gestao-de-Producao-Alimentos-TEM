import { handle, requireUser } from "@/lib/api";
import { getChatTitle } from "@/lib/chat-service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  return { title: await getChatTitle() };
});
