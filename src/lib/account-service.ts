import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ApiError, pgCode } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { assertAdmin, ensureAnotherAdmin, lockAccess, resolveRole, revokeSessions } from "@/lib/access-control";
import { avatarUrl, type MyProfileDTO, type Role, type SessionUser } from "@/lib/domain";

export const roleInput = z.string().regex(/^(admin|producao|qualidade|acabamento|logistica|custom:[1-9]\d*)$/, "Perfil inválido.").transform((v) => v as Role);
const name = z.string().trim().min(2, "Use pelo menos 2 caracteres no nome.").max(80);
const email = z.string().trim().toLowerCase().max(254, "O e-mail deve ter até 254 caracteres.").pipe(z.email("Informe um e-mail válido."));
const password = z.string().min(8, "A senha precisa ter pelo menos 8 caracteres.").max(128);
const createSchema = z.object({ name, email, password, role: roleInput }).strict();
const updateSchema = z.object({
  id: z.number().int().positive(), name: name.optional(), email: email.optional(),
  password: password.optional(), role: roleInput.optional(), active: z.boolean().optional(),
}).strict();

function emailConflict(e: unknown): never {
  if (pgCode(e) === "23505") throw new ApiError(409, "Já existe um usuário com este e-mail.");
  throw e;
}

export async function createUser(actor: SessionUser, raw: unknown) {
  assertAdmin(actor);
  const data = createSchema.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      await lockAccess(tx);
      const resolved = await resolveRole(tx, data.role);
      const [user] = await tx.insert(users).values({ name: data.name, email: data.email, ...resolved, passwordHash: hashPassword(data.password) }).returning({ id: users.id });
      return { id: user.id };
    });
  } catch (e) { emailConflict(e); }
}

export async function updateUser(actor: SessionUser, raw: unknown, currentToken?: string | null) {
  assertAdmin(actor);
  const { id, password: newPassword, role, ...changes } = updateSchema.parse(raw);
  try {
    await db.transaction(async (tx) => {
      await lockAccess(tx);
      const [target] = await tx.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).for("update");
      if (!target) throw new ApiError(404, "Usuário não encontrado.");
      if (actor.id === id && (changes.active === false || (role && role !== "admin"))) throw new ApiError(400, "Você não pode remover o seu próprio acesso de administrador.");
      if (target.role === "admin" && target.active && (changes.active === false || (role && role !== "admin"))) await ensureAnotherAdmin(tx, id);
      const resolved = role ? await resolveRole(tx, role) : {};
      await tx.update(users).set({ ...changes, ...resolved, ...(newPassword ? { passwordHash: hashPassword(newPassword) } : {}), updatedAt: new Date() }).where(eq(users.id, id));
      if (changes.active === false || newPassword || (role && role !== target.role) || (changes.email && changes.email !== target.email)) {
        await revokeSessions(tx, id, actor.id === id ? currentToken : null);
      }
    });
  } catch (e) { emailConflict(e); }
}

/** Excluir impede login e remove da lista, sem destruir os registros feitos por essa pessoa. */
export async function deleteUser(actor: SessionUser, id: number) {
  assertAdmin(actor);
  if (actor.id === id) throw new ApiError(400, "Você não pode excluir a conta que está usando.");
  await db.transaction(async (tx) => {
    await lockAccess(tx);
    const [target] = await tx.select().from(users).where(and(eq(users.id, id), isNull(users.deletedAt))).for("update");
    if (!target) throw new ApiError(404, "Usuário não encontrado.");
    if (target.role === "admin" && target.active) await ensureAnotherAdmin(tx, id);
    await tx.update(users).set({ active: false, deletedAt: new Date(), deletedByName: actor.name, avatarData: null, avatarVersion: null, bio: null, updatedAt: new Date() }).where(eq(users.id, id));
    await revokeSessions(tx, id);
  });
}

const myProfileSchema = z.object({
  name: name.optional(),
  bio: z.string().trim().max(280, "A descrição deve ter até 280 caracteres.").nullable().optional(),
  photoData: z.string().max(7_000_000, "Foto muito grande. Use até 5 MB.").nullable().optional(),
  currentPassword: z.string().max(128).optional(),
  newPassword: password.optional(),
  confirmPassword: z.string().max(128).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.newPassword && !value.currentPassword) ctx.addIssue({ code: "custom", path: ["currentPassword"], message: "Informe sua senha atual para definir uma nova senha." });
  if (value.newPassword && value.newPassword !== value.confirmPassword) ctx.addIssue({ code: "custom", path: ["confirmPassword"], message: "A confirmação da nova senha não confere." });
});

async function preparePhoto(data: string | null) {
  if (data === null) return { avatarData: null, avatarVersion: null };
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw new ApiError(400, "Use uma foto PNG, JPG ou WebP.");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 5 * 1024 * 1024) throw new ApiError(413, "Foto muito grande. Use até 5 MB.");
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const webp = buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (!png && !jpeg && !webp) throw new ApiError(400, "O conteúdo do arquivo não corresponde a uma foto PNG, JPG ou WebP.");
  try {
    const image = sharp(buffer, { limitInputPixels: 24_000_000 });
    const metadata = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("invalid format");
    const thumbnail = await image.rotate().resize(256, 256, { fit: "cover", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    return { avatarData: `data:image/webp;base64,${thumbnail.toString("base64")}`, avatarVersion: createHash("sha256").update(thumbnail).digest("hex") };
  } catch { throw new ApiError(400, "Não foi possível abrir a foto. Use PNG, JPG ou WebP válido, com até 24 megapixels."); }
}

export async function saveMyProfile(user: SessionUser, raw: unknown, currentToken: string | null): Promise<{ user: MyProfileDTO; passwordChanged: boolean }> {
  const data = myProfileSchema.parse(raw);
  const photo = data.photoData === undefined ? {} : await preparePhoto(data.photoData);
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(users).where(and(eq(users.id, user.id), eq(users.active, true), isNull(users.deletedAt))).for("update");
    if (!current) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
    if (data.newPassword && !verifyPassword(data.currentPassword!, current.passwordHash)) throw new ApiError(400, "A senha atual está incorreta.");
    const [updated] = await tx.update(users).set({
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.bio !== undefined ? { bio: data.bio || null } : {}),
      ...photo,
      ...(data.newPassword ? { passwordHash: hashPassword(data.newPassword) } : {}),
      updatedAt: new Date(),
    }).where(eq(users.id, user.id)).returning({ id: users.id, name: users.name, email: users.email, bio: users.bio, avatarVersion: users.avatarVersion });
    if (data.newPassword) await revokeSessions(tx, user.id, currentToken);
    return {
      user: { ...user, name: updated.name, email: updated.email, bio: updated.bio, avatarUrl: avatarUrl(user.id, updated.avatarVersion) },
      passwordChanged: !!data.newPassword,
    };
  });
}
