import { handle, parseId, readBody, readJson, requireAdmin } from "@/lib/api";
import { createChannel, deleteChannel, updateChannel } from "@/lib/chat-service";
export const POST = handle(async (req) => { const u = await requireAdmin(req); await createChannel(u, await readJson(req)); return { ok: true }; });
export const PATCH = handle(async (req) => { const u = await requireAdmin(req); await updateChannel(u, await readJson(req)); return { ok: true }; });
export const DELETE = handle(async (req) => { const u = await requireAdmin(req); await deleteChannel(u, parseId(req.nextUrl.searchParams.get("id") ?? "")); return { ok: true }; });
