import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accessProfiles, sessions, users } from "@/db/schema";
import { ApiError, pgCode } from "@/lib/api";
import { assertAdmin, lockAccess, resolveRole } from "@/lib/access-control";
import { roleInput } from "@/lib/account-service";
import { ACTION_LABEL, type Action, type SessionUser } from "@/lib/domain";

const schema = z.object({
  name: z.string().trim().min(2, "Informe o nome do perfil.").max(40),
  description: z.string().trim().max(200).nullish().transform((v) => v || null),
  permissions: z.array(z.enum(Object.keys(ACTION_LABEL) as [Action, ...Action[]])).max(20),
  active: z.boolean().optional(),
});
const patch = z.object({ id: z.number().int().positive() }).merge(schema.partial());

export async function createProfile(user: SessionUser, raw: unknown) {
  assertAdmin(user);
  const data = schema.parse(raw);
  try {
    const [p] = await db.insert(accessProfiles).values(data).returning({ id: accessProfiles.id });
    return { id: p.id };
  } catch (e) { if (pgCode(e) === "23505") throw new ApiError(409, "Já existe um perfil com esse nome."); throw e; }
}

export async function updateProfile(user: SessionUser, raw: unknown) {
  assertAdmin(user);
  const { id, ...changes } = patch.parse(raw);
  if (!Object.keys(changes).length) return;
  try {
    await db.transaction(async (tx) => {
      await lockAccess(tx);
      const [profile] = await tx.select().from(accessProfiles).where(and(eq(accessProfiles.id, id), isNull(accessProfiles.deletedAt))).for("update");
      if (!profile) throw new ApiError(404, "Perfil não encontrado.");
      await tx.update(accessProfiles).set(changes).where(eq(accessProfiles.id, id));
      const affected = await tx.select({ id: users.id }).from(users).where(and(eq(users.profileId, id), isNull(users.deletedAt)));
      if (affected.length && (changes.active === false || changes.permissions)) await tx.delete(sessions).where(inArray(sessions.userId, affected.map((u) => u.id)));
    });
  } catch (e) { if (pgCode(e) === "23505") throw new ApiError(409, "Já existe um perfil com esse nome."); throw e; }
}

/** Exclusão com transferência opcional, na mesma transação. Não transforma ninguém em admin por padrão. */
export async function deleteProfile(user: SessionUser, id: number, replacement?: string | null) {
  assertAdmin(user);
  const replacementRole = replacement ? roleInput.parse(replacement) : null;
  if (replacementRole === `custom:${id}`) throw new ApiError(400, "Escolha um perfil substituto diferente do que será excluído.");
  return db.transaction(async (tx) => {
    await lockAccess(tx);
    const [profile] = await tx.select().from(accessProfiles).where(and(eq(accessProfiles.id, id), isNull(accessProfiles.deletedAt))).for("update");
    if (!profile) throw new ApiError(404, "Perfil não encontrado.");
    const affected = await tx.select({ id: users.id }).from(users).where(and(eq(users.profileId, id), isNull(users.deletedAt)));
    if (affected.length && !replacementRole) throw new ApiError(409, `Escolha o perfil que receberá os ${affected.length} usuário(s) vinculados.`);
    if (replacementRole && affected.length) {
      const resolved = await resolveRole(tx, replacementRole);
      await tx.update(users).set({ ...resolved, updatedAt: new Date() }).where(inArray(users.id, affected.map((u) => u.id)));
      await tx.delete(sessions).where(inArray(sessions.userId, affected.map((u) => u.id)));
    }
    await tx.update(accessProfiles).set({ active: false, deletedAt: new Date(), deletedByName: user.name }).where(eq(accessProfiles.id, id));
    return { ok: true, reassigned: affected.length };
  });
}
