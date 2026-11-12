import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accessProfiles, users } from "@/db/schema";
import { ApiError, pgCode } from "@/lib/api";
import {
  GRANTABLE_ACTIONS,
  ROLES,
  type Role,
  type SessionUser,
} from "@/lib/domain";

const profileBase = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Use pelo menos 2 caracteres.")
    .max(40, "Use no máximo 40 caracteres."),
  description: z
    .string()
    .trim()
    .max(200, "Use no máximo 200 caracteres.")
    .default(""),
  baseRole: z.enum(ROLES),
  grants: z.array(z.enum(GRANTABLE_ACTIONS)).default([]),
  active: z.boolean().default(true),
});

export const createProfileSchema = profileBase;
export const updateProfileSchema = profileBase
  .partial()
  .extend({ id: z.number().int().positive() });

function adminOnly(user: SessionUser) {
  if (user.role !== "admin")
    throw new ApiError(
      403,
      "Somente o administrador pode gerenciar perfis de acesso.",
    );
}

export async function createProfile(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const data = createProfileSchema.parse(raw);
  try {
    const [row] = await db
      .insert(accessProfiles)
      .values({ ...data, grants: [...new Set(data.grants)] })
      .returning({ id: accessProfiles.id });
    return { id: row.id };
  } catch (e) {
    if (pgCode(e) === "23505")
      throw new ApiError(409, "Já existe um perfil com este nome.");
    throw e;
  }
}

export async function updateProfile(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const { id, ...changes } = updateProfileSchema.parse(raw);
  const [current] = await db
    .select()
    .from(accessProfiles)
    .where(eq(accessProfiles.id, id))
    .limit(1);
  if (!current) throw new ApiError(404, "Perfil não encontrado.");
  const next = {
    ...changes,
    ...(changes.grants ? { grants: [...new Set(changes.grants)] } : {}),
  };
  try {
    await db.update(accessProfiles).set(next).where(eq(accessProfiles.id, id));
  } catch (e) {
    if (pgCode(e) === "23505")
      throw new ApiError(409, "Já existe um perfil com este nome.");
    throw e;
  }
  // O papel-base de todos os usuários deste perfil acompanha a mudança.
  if (changes.baseRole) {
    await db
      .update(users)
      .set({ role: changes.baseRole as Role })
      .where(eq(users.profileId, id));
  }
}

export async function deleteProfile(user: SessionUser, id: number) {
  adminOnly(user);
  const [current] = await db
    .select()
    .from(accessProfiles)
    .where(eq(accessProfiles.id, id))
    .limit(1);
  if (!current) throw new ApiError(404, "Perfil não encontrado.");
  // Os usuários continuam com o papel-base, apenas perdem as permissões extras.
  await db
    .update(users)
    .set({ profileId: null })
    .where(eq(users.profileId, id));
  await db.delete(accessProfiles).where(eq(accessProfiles.id, id));
}

export async function profileRole(profileId: number): Promise<Role> {
  const [row] = await db
    .select({ baseRole: accessProfiles.baseRole })
    .from(accessProfiles)
    .where(eq(accessProfiles.id, profileId))
    .limit(1);
  if (!row) throw new ApiError(400, "Perfil de acesso inexistente.");
  return row.baseRole;
}
