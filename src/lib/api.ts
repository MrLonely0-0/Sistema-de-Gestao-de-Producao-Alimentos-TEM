import { NextResponse, type NextRequest } from "next/server";
import { z, ZodError, type ZodType } from "zod";
import { getUserByToken, SESSION_COOKIE } from "@/lib/auth";
import type { Role, SessionUser } from "@/lib/domain";

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
export function requestToken(req: NextRequest | Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }
  const custom = req.headers.get("x-tem-session");
  if (custom) return custom;
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get("t");
  if (fromQuery) return fromQuery;
  if ("cookies" in req && typeof req.cookies.get === "function") {
    return req.cookies.get(SESSION_COOKIE)?.value ?? null;
  }
  const rawCookie = req.headers.get("cookie") ?? "";
  const match = rawCookie.match(/(?:^|;\s*)tem_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Exige sessão válida e, se informado, um dos perfis (admin sempre passa). */
export async function requireUser(req: NextRequest, ...roles: Role[]): Promise<SessionUser> {
  const user = await getUserByToken(requestToken(req));
  if (!user) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  if (roles.length > 0 && user.role !== "admin" && !roles.includes(user.role)) {
    throw new ApiError(403, "Seu perfil não tem permissão para esta ação.");
  }
  return user;
}

export async function requireAdmin(req: NextRequest): Promise<SessionUser> {
  const user = await getUserByToken(requestToken(req));
  if (!user) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
  if (user.role !== "admin") throw new ApiError(403, "Apenas administradores podem acessar esta área.");
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
