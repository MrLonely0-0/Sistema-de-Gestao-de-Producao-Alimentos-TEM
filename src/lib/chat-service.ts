import { desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appSettings, chatMessages } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/domain";

export const DEFAULT_CHAT_TITLE = "Conversa da equipe";
const TITLE_KEY = "chat_title";

export async function getChatTitle(): Promise<string> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, TITLE_KEY))
    .limit(1);
  return row?.value || DEFAULT_CHAT_TITLE;
}

export const titleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Use pelo menos 2 caracteres.")
    .max(30, "Use no máximo 30 caracteres."),
});

export async function setChatTitle(
  user: SessionUser,
  raw: unknown,
): Promise<string> {
  if (user.role !== "admin")
    throw new ApiError(
      403,
      "Somente o administrador pode renomear a aba de chat.",
    );
  const { title } = titleSchema.parse(raw);
  await db
    .insert(appSettings)
    .values({ key: TITLE_KEY, value: title, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: title, updatedAt: new Date() },
    });
  return title;
}

const messageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Escreva uma mensagem.")
    .max(1000, "Use no máximo 1000 caracteres."),
});

export async function postMessage(user: SessionUser, raw: unknown) {
  const { body } = messageSchema.parse(raw);
  const [row] = await db
    .insert(chatMessages)
    .values({ userId: user.id, userName: user.name, userRole: user.role, body })
    .returning();
  return row;
}

/** Mensagens mais recentes (ou as posteriores a `after`, para atualização incremental). */
export async function listMessages(after: number | null) {
  if (after) {
    return db
      .select()
      .from(chatMessages)
      .where(gt(chatMessages.id, after))
      .orderBy(chatMessages.id)
      .limit(200);
  }
  const rows = await db
    .select()
    .from(chatMessages)
    .orderBy(desc(chatMessages.id))
    .limit(100);
  return rows.reverse();
}

export async function unreadSince(id: number | null): Promise<number> {
  if (!id) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(gt(chatMessages.id, id));
  return row?.n ?? 0;
}
