import { z } from "zod";
import { handle, parseId, readJson, readBody, requireUser } from "@/lib/api";
import { deleteMessage, editMessage, getChat, markRead, sendMessage } from "@/lib/chat-service";
export const dynamic = "force-dynamic";
export const GET = handle(async (req) => {
  const u = await requireUser(req);
  const raw = req.nextUrl.searchParams.get("channelId");
  return getChat(u, raw ? parseId(raw) : undefined);
});
export const POST = handle(async (req) => { const u = await requireUser(req); await sendMessage(u, await readJson(req)); return { ok: true }; });
export const PATCH = handle(async (req) => { const u = await requireUser(req); await editMessage(u, await readJson(req)); return { ok: true }; });
export const DELETE = handle(async (req) => { const u = await requireUser(req); await deleteMessage(u, parseId(req.nextUrl.searchParams.get("id") ?? "")); return { ok: true }; });
