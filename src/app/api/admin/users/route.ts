import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { ApiError, handle, pgCode, readBody, requireAdmin } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { ROLES } from "@/lib/domain";
import { profileRole } from "@/lib/profile-service";

const name = z
  .string()
  .trim()
  .min(2, "Informe o nome completo.")
  .max(80, "Use no máximo 80 caracteres.");
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Informe um e-mail válido."));
const password = z
  .string()
  .min(8, "A senha precisa ter ao menos 8 caracteres.")
  .max(100);
const profileId = z.number().int().positive().nullable();

const createSchema = z.object({
  name,
  email,
  password,
  role: z.enum(ROLES).optional(),
  profileId: profileId.optional(),
});
const updateSchema = z.object({
  id: z.number().int().positive(),
  name: name.optional(),
  role: z.enum(ROLES).optional(),
  profileId: profileId.optional(),
  active: z.boolean().optional(),
  password: password.optional(),
});

/** Com perfil escolhido, o papel-base é o do perfil; sem perfil, usa o papel informado. */
async function resolveRole(
  profile: number | null | undefined,
  role: (typeof ROLES)[number] | undefined,
) {
  if (profile) return profileRole(profile);
  if (role) return role;
  throw new ApiError(400, "Escolha um perfil de acesso ou um papel padrão.");
}

export const POST = handle(async (req) => {
  await requireAdmin(req);
  const data = await readBody(req, createSchema);
  const role = await resolveRole(data.profileId, data.role);
  try {
    await db.insert(users).values({
      name: data.name,
      email: data.email,
      role,
      profileId: data.profileId ?? null,
      passwordHash: hashPassword(data.password),
    });
  } catch (e) {
    if (pgCode(e) === "23505")
      throw new ApiError(409, "Já existe um usuário com este e-mail.");
    throw e;
  }
  return { ok: true };
});

export const PATCH = handle(async (req) => {
  const me = await requireAdmin(req);
  const {
    id,
    password: newPassword,
    ...changes
  } = await readBody(req, updateSchema);

  // Trava contra o administrador se trancar para fora do sistema.
  const demotes = changes.role !== undefined && changes.role !== "admin";
  const movesProfile = changes.profileId !== undefined;
  if (
    id === me.id &&
    (changes.active === false || demotes || (movesProfile && changes.profileId))
  ) {
    throw new ApiError(
      400,
      "Você não pode remover o seu próprio acesso de administrador.",
    );
  }

  const patch: Record<string, unknown> = { ...changes };
  if (changes.profileId !== undefined) {
    // Ao escolher um perfil, o papel acompanha o perfil; ao remover, mantém o papel atual.
    if (changes.profileId) patch.role = await profileRole(changes.profileId);
  } else if (changes.role !== undefined) {
    // Trocar só o papel remove o perfil personalizado (ele não se aplica mais).
    patch.profileId = null;
  }
  if (newPassword) patch.passwordHash = hashPassword(newPassword);

  const [updated] = await db
    .update(users)
    .set(patch)
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!updated) throw new ApiError(404, "Usuário não encontrado.");

  // Desativar, trocar a senha ou mudar o papel/perfil derruba as sessões abertas.
  if (
    changes.active === false ||
    newPassword ||
    changes.role !== undefined ||
    changes.profileId !== undefined
  ) {
    await db
      .delete(sessions)
      .where(and(eq(sessions.userId, id), ne(sessions.userId, me.id)));
  }
  return { ok: true };
});
