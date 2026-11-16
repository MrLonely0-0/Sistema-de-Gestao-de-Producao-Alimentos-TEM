import { and, asc, count, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { chatChannels, chatMembers, chatMessages, chatReads, users } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { avatarUrl, roleLabel, type ChatDTO, type ChatChannelDTO, type ChatUnreadDTO, type SessionUser } from "@/lib/domain";

const text = z.string().trim().max(4000, "Máximo de 4.000 caracteres.");
const imageSchema = z
  .string()
  .max(2_400_000, "A foto é muito grande. Use uma imagem de até 1,5 MB.")
  .refine((v) => /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v), "Formato de imagem inválido.")
  .nullish()
  .transform((v) => v ?? null);
const channelSchema = z.object({
  name: text.min(1, "Informe o nome do canal.").max(40),
  description: z.string().trim().max(120).nullish().transform((v) => v || null),
});

/** Canais visíveis: canais da equipe + conversas diretas das quais participo. */
async function visibleChannels(user: SessionUser) {
  const memberships = await db.select({ channelId: chatMembers.channelId }).from(chatMembers).where(eq(chatMembers.userId, user.id));
  const memberIds = memberships.map((m) => m.channelId);
  return db
    .select()
    .from(chatChannels)
    .where(
      and(
        eq(chatChannels.active, true),
        or(eq(chatChannels.kind, "channel"), memberIds.length ? inArray(chatChannels.id, memberIds) : sql`false`),
      ),
    )
    .orderBy(asc(chatChannels.kind), asc(chatChannels.id));
}

async function unreadFor(user: SessionUser, channelIds: number[]) {
  if (channelIds.length === 0) return new Map<number, number>();
  const reads = await db.select().from(chatReads).where(and(eq(chatReads.userId, user.id), inArray(chatReads.channelId, channelIds)));
  const map = new Map<number, number>();
  await Promise.all(
    channelIds.map(async (id) => {
      const read = reads.find((r) => r.channelId === id);
      const [row] = await db
        .select({ n: count() })
        .from(chatMessages)
        .where(and(eq(chatMessages.channelId, id), isNull(chatMessages.deletedAt), read ? gt(chatMessages.createdAt, read.lastReadAt) : undefined));
      map.set(id, row.n);
    }),
  );
  return map;
}

/** Nome amigável de uma conversa direta: o outro participante. */
async function directNames(channels: Array<typeof chatChannels.$inferSelect>, userId: number) {
  const directIds = channels.filter((c) => c.kind === "direct").map((c) => c.id);
  if (directIds.length === 0) return new Map<number, string>();
  const rows = await db
    .select({ channelId: chatMembers.channelId, name: users.name })
    .from(chatMembers)
    .innerJoin(users, eq(users.id, chatMembers.userId))
    .where(and(inArray(chatMembers.channelId, directIds), sql`${chatMembers.userId} <> ${userId}`));
  return new Map(rows.map((r) => [r.channelId, r.name]));
}

export async function getChat(user: SessionUser, channelId?: number): Promise<ChatDTO> {
  const channels = await visibleChannels(user);
  const [reads, latest, peers] = await Promise.all([
    db.select().from(chatReads).where(eq(chatReads.userId, user.id)),
    db.select().from(chatMessages).where(isNull(chatMessages.deletedAt)).orderBy(desc(chatMessages.createdAt)).limit(300),
    db.select().from(users).where(and(eq(users.active, true), isNull(users.deletedAt))).orderBy(asc(users.name)),
  ]);
  const names = await directNames(channels, user.id);
  const unread = await unreadFor(user, channels.map((c) => c.id));
  const counts = await db
    .select({ channelId: chatMessages.channelId, n: count() })
    .from(chatMessages)
    .where(isNull(chatMessages.deletedAt))
    .groupBy(chatMessages.channelId);
  const countMap = new Map(counts.map((c) => [c.channelId, c.n]));

  const toDTO = (c: typeof chatChannels.$inferSelect): ChatChannelDTO => {
    const last = latest.find((m) => m.channelId === c.id);
    const peer = names.get(c.id);
    return {
      id: c.id,
      name: c.kind === "direct" ? peer ?? "Conversa particular" : c.name,
      description: c.kind === "direct" ? "Conversa particular" : c.description,
      kind: c.kind,
      peerName: c.kind === "direct" ? peer ?? null : null,
      messageCount: countMap.get(c.id) ?? 0,
      unreadCount: unread.get(c.id) ?? 0,
      lastMessage: last?.imageData ? "📷 Foto" : last?.content ?? null,
      lastAt: last?.createdAt.toISOString() ?? null,
    };
  };
  const teamChannels = channels.filter((c) => c.kind === "channel").map(toDTO);
  const direct = channels.filter((c) => c.kind === "direct").map(toDTO);

  const activeChannelId = channelId ?? teamChannels[0]?.id ?? direct[0]?.id ?? null;
  const messages = activeChannelId
    ? (
        await db
          .select()
          .from(chatMessages)
          .where(and(eq(chatMessages.channelId, activeChannelId), isNull(chatMessages.deletedAt)))
          .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
          .limit(100)
      ).reverse()
    : [];

  return {
    channels: teamChannels,
    direct,
    activeChannelId,
    peers: peers
      .filter((p) => p.id !== user.id)
      .map((p) => ({ id: p.id, name: p.name, roleLabel: roleLabel(p.role) })),
    messages: messages.map((m) => ({
      id: m.id,
      channelId: m.channelId,
      authorName: m.authorName,
      authorId: m.userId,
      isMine: m.userId === user.id,
      avatarUrl: m.userId ? avatarUrl(m.userId, peers.find((p) => p.id === m.userId)?.avatarVersion) : null,
      authorRole: m.authorRole,
      content: m.content,
      imageData: m.imageData,
      imageName: m.imageName,
      createdAt: m.createdAt.toISOString(),
      editedAt: m.editedAt?.toISOString() ?? null,
      canEdit: m.userId === user.id || user.role === "admin",
      canDelete: m.userId === user.id || user.role === "admin",
    })),
  };
}

export async function getUnread(user: SessionUser): Promise<ChatUnreadDTO> {
  const channels = await visibleChannels(user);
  const unread = await unreadFor(user, channels.map((c) => c.id));
  const names = await directNames(channels, user.id);
  const byChannel = channels
    .map((c) => ({ id: c.id, name: c.kind === "direct" ? names.get(c.id) ?? "Conversa particular" : c.name, kind: c.kind, unread: unread.get(c.id) ?? 0 }))
    .filter((c) => c.unread > 0);
  return { total: byChannel.reduce((acc, c) => acc + c.unread, 0), byChannel };
}

export async function ensureMember(channelId: number, userId: number) {
  await db.insert(chatMembers).values({ channelId, userId }).onConflictDoNothing();
}

export async function openDirect(user: SessionUser, raw: unknown): Promise<{ channelId: number }> {
  const { userId } = z.object({ userId: z.number().int().positive() }).parse(raw);
  if (userId === user.id) throw new ApiError(400, "Escolha outro colaborador para a conversa particular.");
  const [peer] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.active, true), isNull(users.deletedAt)));
  if (!peer) throw new ApiError(404, "Colaborador não encontrado.");
  const mine = await db.select({ channelId: chatMembers.channelId }).from(chatMembers).where(eq(chatMembers.userId, user.id));
  const theirs = await db.select({ channelId: chatMembers.channelId }).from(chatMembers).where(eq(chatMembers.userId, userId));
  const shared = mine.map((m) => m.channelId).filter((id) => theirs.some((t) => t.channelId === id));
  if (shared.length > 0) {
    const [existing] = await db.select().from(chatChannels).where(and(inArray(chatChannels.id, shared), eq(chatChannels.kind, "direct")));
    if (existing) return { channelId: existing.id };
  }
  const [created] = await db
    .insert(chatChannels)
    .values({ name: `direto-${Math.min(user.id, userId)}-${Math.max(user.id, userId)}-${Date.now()}`, kind: "direct", description: "Conversa particular" })
    .returning({ id: chatChannels.id });
  await ensureMember(created.id, user.id);
  await ensureMember(created.id, userId);
  return { channelId: created.id };
}

export async function sendMessage(user: SessionUser, raw: unknown) {
  const data = z
    .object({ channelId: z.number().int().positive(), content: text, imageData: imageSchema, imageName: z.string().trim().max(160).nullish().transform((v) => v || null) })
    .parse(raw);
  if (!data.content.trim() && !data.imageData) throw new ApiError(400, "Escreva uma mensagem ou anexe uma foto.");
  const [channel] = await db.select().from(chatChannels).where(and(eq(chatChannels.id, data.channelId), eq(chatChannels.active, true)));
  if (!channel) throw new ApiError(404, "Canal não encontrado.");
  if (channel.kind === "direct") {
    const [member] = await db.select().from(chatMembers).where(and(eq(chatMembers.channelId, channel.id), eq(chatMembers.userId, user.id)));
    if (!member) throw new ApiError(403, "Você não participa desta conversa.");
  }
  await db.insert(chatMessages).values({
    channelId: data.channelId,
    userId: user.id,
    authorName: user.name,
    authorRole: user.role,
    content: data.content,
    imageData: data.imageData,
    imageName: data.imageName,
  });
}

export async function editMessage(user: SessionUser, raw: unknown) {
  const { id, content } = z.object({ id: z.number().int().positive(), content: text.min(1, "Escreva a mensagem.") }).parse(raw);
  const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
  if (!m || m.deletedAt) throw new ApiError(404, "Mensagem não encontrada.");
  if (m.userId !== user.id && user.role !== "admin") throw new ApiError(403, "Você só pode editar as suas mensagens.");
  await db.update(chatMessages).set({ content, editedAt: new Date() }).where(eq(chatMessages.id, id));
}

export async function deleteMessage(user: SessionUser, id: number) {
  const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, id));
  if (!m || m.deletedAt) throw new ApiError(404, "Mensagem não encontrada.");
  if (m.userId !== user.id && user.role !== "admin") throw new ApiError(403, "Você só pode excluir as suas mensagens.");
  await db.update(chatMessages).set({ deletedAt: new Date() }).where(eq(chatMessages.id, id));
}

export async function markRead(user: SessionUser, channelId: number) {
  await db
    .insert(chatReads)
    .values({ userId: user.id, channelId, lastReadAt: new Date() })
    .onConflictDoUpdate({ target: [chatReads.userId, chatReads.channelId], set: { lastReadAt: sql`now()` } });
}

export async function createChannel(user: SessionUser, raw: unknown) {
  if (user.role !== "admin") throw new ApiError(403, "Apenas o administrador pode criar canais.");
  const data = channelSchema.parse(raw);
  try {
    await db.insert(chatChannels).values({ ...data, kind: "channel" });
  } catch (e) {
    const err = e as { cause?: { code?: string } };
    if (err.cause?.code === "23505") throw new ApiError(409, "Já existe um canal com esse nome.");
    throw e;
  }
}

export async function updateChannel(user: SessionUser, raw: unknown) {
  if (user.role !== "admin") throw new ApiError(403, "Apenas o administrador pode editar canais.");
  const { id, ...data } = z.object({ id: z.number().int().positive() }).merge(channelSchema.partial()).parse(raw);
  await db.update(chatChannels).set(data).where(and(eq(chatChannels.id, id), eq(chatChannels.kind, "channel")));
}

export async function deleteChannel(user: SessionUser, id: number) {
  if (user.role !== "admin") throw new ApiError(403, "Apenas o administrador pode excluir canais.");
  await db.update(chatChannels).set({ active: false }).where(eq(chatChannels.id, id));
}
