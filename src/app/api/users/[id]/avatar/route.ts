import type { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ApiError, parseId, requireUser } from "@/lib/api";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(req);
    const id = parseId((await params).id);
    const [user] = await db.select({ photo: users.avatarData, version: users.avatarVersion }).from(users).where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (!user?.photo || !user.version) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
    const bytes = Buffer.from(user.photo.split(",")[1], "base64");
    const etag = `"${user.version}"`;
    const headers = { "content-type": "image/webp", "cache-control": "private, no-cache", "x-content-type-options": "nosniff", etag };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(bytes), { headers });
  } catch (e) {
    if (e instanceof ApiError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Não foi possível carregar a foto." }, { status: 500 });
  }
}
