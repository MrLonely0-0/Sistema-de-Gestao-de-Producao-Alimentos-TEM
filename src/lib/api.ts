import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { getUserByToken, SESSION_COOKIE } from "@/lib/auth";
import {
  canOpenAdmin,
  hasAdminCapability,
  isAnyAdmin,
  isReadOnly,
  type AdminCapability,
  type Role,
  type SessionUser,
} from "@/lib/domain";

// Mensagens de validação em português.
z.config(z.locales.pt());

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Código de erro do PostgreSQL (o Drizzle embrulha o erro original em `cause`). */
export function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.cause?.code ?? err?.code;
}

/**
 * Prova de que a escrita partiu da própria aplicação (defesa contra CSRF).
 * Basta um dos sinais, todos definidos pelo navegador e que um site de
 * terceiros não consegue forjar:
 *  - `x-tem-client`: cabeçalho que o nosso cliente envia em toda escrita;
 *  - `Origin`/`Referer` do mesmo host;
 *  - `Sec-Fetch-Site` same-origin/same-site/none;
 *  - corpo `application/json` (ver comentário no fim da função).
 * Não exigimos só o primeiro porque proxies e navegadores embutidos podem
 * removê-lo — foi o que impedia o login em alguns ambientes.
 */
function isTrustedWrite(req: NextRequest): boolean {
  if (req.headers.get("x-tem-client") === "1") return true;

  const host = req.headers.get("host");
  if (host) {
    for (const name of ["origin", "referer"] as const) {
      const value = req.headers.get(name);
      if (!value) continue;
      try {
        if (new URL(value).host === host) return true;
      } catch {
        /* valor inválido: ignora este sinal */
      }
    }
  }

  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "same-site" || site === "none") return true;

  // Corpo JSON só chega aqui vindo do nosso cliente: um site de terceiros não
  // consegue enviar `application/json` sem um preflight CORS, que não
  // respondemos. É o último recurso para ambientes que removem cabeçalhos.
  return (req.headers.get("content-type") ?? "").startsWith("application/json");
}

/** Embrulha um handler de rota: trata os erros de forma uniforme. */
export function handle<C = unknown>(fn: (req: NextRequest, ctx: C) => Promise<unknown>) {
  return async (req: NextRequest, ctx: C): Promise<NextResponse> => {
    try {
      if (req.method !== "GET" && !isTrustedWrite(req)) {
        console.warn("[api] escrita bloqueada por origem não confiável:", req.nextUrl.pathname, {
          hasClientHeader: req.headers.has("x-tem-client"),
          origin: req.headers.get("origin"),
          referer: req.headers.get("referer"),
          secFetchSite: req.headers.get("sec-fetch-site"),
        });
        throw new ApiError(403, "Não foi possível confirmar a origem da requisição. Recarregue a página e tente novamente.");
      }
      const data = await fn(req, ctx);
      return NextResponse.json(data ?? { ok: true }, { headers: { "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      if (e instanceof ZodError) {
        const issue = e.issues[0];
        return NextResponse.json({ error: issue?.message ?? "Dados inválidos." }, { status: 400 });
      }
      if (pgCode(e) === "P0001") {
        // RAISE EXCEPTION dos triggers de proteção (ex.: carimbo imutável).
        return NextResponse.json({ error: "Operação bloqueada: o carimbo de liberação é imutável." }, { status: 409 });
      }
      console.error("[api]", req.method, req.nextUrl.pathname, e);
      return NextResponse.json({ error: "Erro interno. Tente novamente em instantes." }, { status: 500 });
    }
  };
}

/**
 * Token da sessão em qualquer canal: `Authorization`, `x-tem-session`, a query
 * `?t=` ou o cookie. Vários proxies removem cabeçalhos desconhecidos, então a
 * URL é o canal mais resistente — por isso ela também é aceita.
 */
export function requestTokenCandidates(req: NextRequest | Request): {
  clientToken: string | null;
  cookieToken: string | null;
  tokens: string[];
} {
  let clientToken: string | null = null;
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const value = auth.slice(7).trim();
    if (value) clientToken = value;
  }
  if (!clientToken) {
    const custom = req.headers.get("x-tem-session");
    if (custom) clientToken = custom;
  }
  if (!clientToken) {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get("t");
    if (fromQuery) clientToken = fromQuery;
  }
  let cookieToken: string | null = null;
  if ("cookies" in req && typeof req.cookies.get === "function") {
    cookieToken = req.cookies.get(SESSION_COOKIE)?.value ?? null;
  } else {
    const rawCookie = req.headers.get("cookie") ?? "";
    const match = rawCookie.match(/(?:^|;\s*)tem_session=([^;]+)/);
    cookieToken = match ? decodeURIComponent(match[1]) : null;
  }
  const tokens = [...new Set([clientToken, cookieToken].filter((t): t is string => !!t))];
  return { clientToken, cookieToken, tokens };
}

export function requestToken(req: NextRequest | Request): string | null {
  return requestTokenCandidates(req).tokens[0] ?? null;
}

export async function resolveSessionFromRequest(req: NextRequest | Request): Promise<{
  user: SessionUser | null;
  matchedToken: string | null;
  clientToken: string | null;
  cookieToken: string | null;
}> {
  const { clientToken, cookieToken, tokens } = requestTokenCandidates(req);
  for (const token of tokens) {
    const user = await getUserByToken(token);
    if (user) return { user, matchedToken: token, clientToken, cookieToken };
  }
  return { user: null, matchedToken: null, clientToken, cookieToken };
}

/** Exige sessão válida e, se informado, um dos perfis (admin_master sempre passa; viewer é somente leitura). */
export async function requireUser(req: NextRequest, ...roles: Role[]): Promise<SessionUser> {
  const { user } = await resolveSessionFromRequest(req);
  if (!user) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  if (req.method !== "GET" && isReadOnly(user.role)) {
    throw new ApiError(403, "Modo visualização (somente leitura): nenhuma alteração pode ser salva.");
  }
  if (roles.length > 0) {
    const allowed =
      user.role === "admin_master" ||
      (user.role === "admin" && hasAdminCapability(user, "operar_fluxo")) ||
      roles.includes(user.role);
    if (!allowed) {
      throw new ApiError(403, "Seu perfil não tem permissão para esta ação.");
    }
  }
  return user;
}

export async function requireAdmin(req: NextRequest, capability?: AdminCapability): Promise<SessionUser> {
  const { user } = await resolveSessionFromRequest(req);
  if (!user) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  if (req.method !== "GET" && isReadOnly(user.role)) {
    throw new ApiError(403, "Modo visualização (somente leitura): alterações não são permitidas.");
  }
  if (!isAnyAdmin(user.role)) throw new ApiError(403, "Apenas administradores podem acessar esta área.");
  if (capability && !hasAdminCapability(user, capability)) {
    throw new ApiError(403, "Seu perfil de administrador não tem permissão para esta área.");
  }
  return user;
}

/** Leitura no Admin: liberada para administradores (conforme limites) e perfil Visualização (somente leitura). */
export async function requireAdminRead(req: NextRequest, capability?: AdminCapability): Promise<SessionUser> {
  const { user } = await resolveSessionFromRequest(req);
  if (!user) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  if (isReadOnly(user.role)) return user;
  if (!isAnyAdmin(user.role)) throw new ApiError(403, "Apenas administradores podem acessar esta área.");
  if (capability && !hasAdminCapability(user, capability)) {
    throw new ApiError(403, "Seu perfil de administrador não tem permissão para visualizar esta área.");
  }
  if (!capability && !canOpenAdmin(user)) {
    throw new ApiError(403, "Seu perfil de administrador está sem permissões no Painel Admin.");
  }
  return user;
}

export async function requireMasterAdmin(req: NextRequest): Promise<SessionUser> {
  const { user } = await resolveSessionFromRequest(req);
  if (!user) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  if (user.role !== "admin_master") {
    throw new ApiError(403, "Apenas o Administrador Master pode executar esta ação.");
  }
  return user;
}

export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Corpo da requisição inválido.");
  }
}

export async function readBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  return schema.parse(await readJson(req));
}

export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(404, "Registro não encontrado.");
  return id;
}
