import { cache } from "react";
import { cookies, headers } from "next/headers";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { accessProfiles, appState, sessions, users } from "@/db/schema";
import {
  ADMIN_CAPABILITIES,
  avatarUrl,
  DEFAULT_ADMIN_LIMITS,
  type AdminCapability,
  type AdminLimits,
  type SessionUser,
} from "@/lib/domain";

export const SESSION_COOKIE = "tem_session";
const TTL_SECONDS = 60 * 60 * 12; // um turno

/* ───────────── Senhas (scrypt nativo do Node, sem dependências) ───────────── */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/* ───────────── Sessões ───────────── */

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * A sessão é entregue de duas formas:
 *  1. token no `Authorization: Bearer` (o navegador guarda e envia sozinho via
 *     lib/client.ts). É o caminho principal: funciona mesmo quando o navegador
 *     bloqueia cookies de terceiros dentro de iframes — comum em painéis de TV,
 *     intranets e pré-visualizações embutidas;
 *  2. cookie httpOnly, para quem acessa a aplicação diretamente e para
 *     navegação inicial renderizada no servidor.
 * O banco guarda apenas o SHA-256 do token.
 */
function isHttps(h: Headers): boolean {
  // Proxies internos costumam informar `http` mesmo quando o navegador está em
  // HTTPS. O `Origin`/`Referer` enviado pelo navegador é a prova mais confiável
  // — sem isso o cookie sairia como `Lax` e seria descartado dentro de iframes.
  for (const name of ["origin", "referer"]) {
    const value = h.get(name);
    if (value?.startsWith("https://")) return true;
  }
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return proto === "https";
}

async function cookieOptions(maxAge: number) {
  const h = await headers();
  const secure = isHttps(h);
  // Em HTTPS o cookie precisa ser `None` para sobreviver dentro de iframes.
  // Para restringir, defina COOKIE_SAMESITE=lax.
  if (secure && process.env.COOKIE_SAMESITE !== "lax") {
    return { httpOnly: true, path: "/", maxAge, secure: true, sameSite: "none" as const, partitioned: true };
  }
  return { httpOnly: true, path: "/", maxAge, secure, sameSite: "lax" as const };
}

/** Cria a sessão e devolve o token em claro — só existe aqui e no navegador. */
export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + TTL_SECONDS * 1000),
  });
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  (await cookies()).set(SESSION_COOKIE, token, await cookieOptions(TTL_SECONDS));
  return token;
}

/** Encerra a sessão do token enviado no cabeçalho, na URL e/ou no cookie. */
export async function destroySession(extraToken?: string | null): Promise<void> {
  const bearer = bearerToken(await headers());
  const store = await cookies();
  const cookieToken = store.get(SESSION_COOKIE)?.value;
  const tokens = [...new Set([bearer, extraToken, cookieToken].filter((t): t is string => !!t))];
  if (tokens.length > 0) {
    await db.delete(sessions).where(inArray(sessions.tokenHash, tokens.map(sha256)));
  }
  store.set(SESSION_COOKIE, "", await cookieOptions(0));
}

function bearerToken(h: Headers): string | null {
  const raw = h.get("authorization");
  if (!raw) return null;
  const [scheme, value] = raw.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}

export function normalizeAdminLimits(raw: unknown): AdminLimits {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as AdminLimits).capabilities)) {
    return { capabilities: [...DEFAULT_ADMIN_LIMITS.capabilities] };
  }
  const allowed = new Set<AdminCapability>(ADMIN_CAPABILITIES);
  const caps = [...new Set((raw as AdminLimits).capabilities.filter((c): c is AdminCapability => allowed.has(c)))];
  return { capabilities: caps };
}

export async function getAdminLimits(): Promise<AdminLimits> {
  try {
    const [state] = await db.select({ adminLimits: appState.adminLimits }).from(appState).where(eq(appState.id, "lifecycle")).limit(1);
    return normalizeAdminLimits(state?.adminLimits);
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } } | null)?.cause?.code ?? (e as { code?: string } | null)?.code;
    if (code === "42703" || code === "42P01") return { capabilities: [...DEFAULT_ADMIN_LIMITS.capabilities] };
    throw e;
  }
}

/** Valida um token (do cabeçalho, da URL ou do cookie) e devolve o usuário. */
export async function getUserByToken(token: string | null): Promise<SessionUser | null> {
  if (!token) return null;
  const ready = await (await import("@/lib/seed")).ensureReady();
  if (!ready.ok) return null;
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, profileId: users.profileId, bio: users.bio, avatarVersion: users.avatarVersion })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()), eq(users.active, true), isNull(users.deletedAt)))
    .limit(1);
  if (!row) return null;
  if (row.role.startsWith("custom:")) {
    const [profile] = await db.select().from(accessProfiles).where(eq(accessProfiles.id, row.profileId ?? 0)).limit(1);
    if (!profile?.active || profile.deletedAt) return null;
    return { id: row.id, name: row.name, email: row.email, role: row.role, bio: row.bio, avatarUrl: avatarUrl(row.id, row.avatarVersion), profileName: profile.name, permissions: profile.permissions };
  }
  if (row.role === "admin_master") {
    return { id: row.id, name: row.name, email: row.email, role: row.role, bio: row.bio, avatarUrl: avatarUrl(row.id, row.avatarVersion), adminCapabilities: [...ADMIN_CAPABILITIES] };
  }
  if (row.role === "admin") {
    const limits = await getAdminLimits();
    return { id: row.id, name: row.name, email: row.email, role: row.role, bio: row.bio, avatarUrl: avatarUrl(row.id, row.avatarVersion), adminCapabilities: limits.capabilities };
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role, bio: row.bio, avatarUrl: avatarUrl(row.id, row.avatarVersion) };
}

/** Usuário da requisição atual (ou null). Memorizado por requisição. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const h = await headers();
  const bearer = bearerToken(h);
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  for (const token of [...new Set([bearer, cookie].filter((t): t is string => !!t))]) {
    const user = await getUserByToken(token);
    if (user) return user;
  }
  return null;
});
