import { z } from "zod";
import { handle, readBody, requireUser } from "@/lib/api";
import { markRead } from "@/lib/chat-service";
export const POST = handle(async (req) => { const u = await requireUser(req); const { channelId } = z.object({ channelId: z.number().int().positive() }).parse(await readBody(req, z.object({ channelId: z.number().int().positive() }))); await markRead(u, channelId); return { ok: true }; });
