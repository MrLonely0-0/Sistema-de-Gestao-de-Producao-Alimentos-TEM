import { createHash } from "node:crypto";
import { and, count, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { accessProfiles, sessions, users } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { hasAdminCapability, isAnyAdmin, isMasterAdmin, type AdminCapability, type Role, type SessionUser } from "@/lib/domain";

export type AccessTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Serializa mudanças administrativas para não excluir/desativar o último Administrador Master por corrida. */
export async function lockAccess(tx: AccessTx) {
  await tx.execute(sql`select pg_advisory_xact_lock(7405102)`);
}

export function assertAdmin(user: SessionUser, capability?: AdminCapability) {
  if (!isAnyAdmin(user.role)) throw new ApiError(403, "Apenas administradores podem gerenciar esta área.");
  if (capability && !hasAdminCapability(user, capability)) {
    throw new ApiError(403, "Seu perfil de administrador não tem permissão para esta ação.");
  }
}

export function assertMasterAdmin(user: SessionUser) {
  if (!isMasterAdmin(user.role)) {
    throw new ApiError(403, "Apenas o Administrador Master pode executar esta ação.");
  }
}

export async function resolveRole(tx: AccessTx, role: Role) {
  if (!role.startsWith("custom:")) return { role, profileId: null };
  const id = Number(role.slice(7));
  const [p] = await tx.select().from(accessProfiles).where(and(eq(accessProfiles.id, id), isNull(accessProfiles.deletedAt))).for("update");
  if (!p?.active) throw new ApiError(400, "Perfil personalizado não encontrado ou inativo.");
  return { role, profileId: id };
}

export async function ensureAnotherMasterAdmin(tx: AccessTx, userId: number) {
  const [row] = await tx.select({ n: count() }).from(users).where(and(
    eq(users.role, "admin_master"), eq(users.active, true), isNull(users.deletedAt), ne(users.id, userId),
  ));
  if (row.n === 0) throw new ApiError(409, "É necessário manter pelo menos um Administrador Master ativo.");
}

export async function revokeSessions(tx: AccessTx, userId: number, keepToken?: string | null) {
  const keepHash = keepToken ? createHash("sha256").update(keepToken).digest("hex") : null;
  await tx.delete(sessions).where(and(eq(sessions.userId, userId), keepHash ? ne(sessions.tokenHash, keepHash) : undefined));
}
