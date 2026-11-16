import { handle, readJson, requireUser } from "@/lib/api";
import { openDirect } from "@/lib/chat-service";
export const POST = handle(async (req) => { const u = await requireUser(req); return openDirect(u, await readJson(req)); });
