import { handle, requireUser } from "@/lib/api";
import { getUnread } from "@/lib/chat-service";
export const dynamic = "force-dynamic";
export const GET = handle(async (req) => { const u = await requireUser(req); return getUnread(u); });
