import { NextRequest } from "next/server";
import { handle, readJson, requireUser } from "@/lib/api";
import { getChatTitle, listMessages, postMessage } from "@/lib/chat-service";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  const afterParam = req.nextUrl.searchParams.get("after");
  const after = afterParam && /^\d+$/.test(afterParam) ? Number(afterParam) : null;
  const [title, rows] = await Promise.all([getChatTitle(), listMessages(after)]);
  return {
    title,
    messages: rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.userName,
      userRole: m.userRole,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const row = await postMessage(user, await readJson(req));
  return { id: row.id, createdAt: row.createdAt.toISOString() };
});
