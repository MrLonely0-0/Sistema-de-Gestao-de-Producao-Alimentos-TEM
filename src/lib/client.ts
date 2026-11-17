/** Utilitários usados apenas no navegador: chamadas à API e formatação pt-BR. */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/* ───────────── Sessão no navegador ─────────────
 * O token da sessão é guardado em três lugares, do mais durável ao mais
 * efêmero: localStorage, sessionStorage e memória. Se o navegador bloquear
 * tudo (iframe de terceiros com armazenamento particionado desativado), ele
 * também pode viajar no `#` da URL logo depois do login, em memória.
 * Em cada chamada ele vai em `Authorization`, em `x-tem-session` e na query
 * `?t=` — assim nem cookie bloqueado nem proxy que remove cabeçalhos derrubam
 * a sessão.
 */
const TOKEN_KEY = "tem_token";
const WINDOW_NAME_PREFIX = "tem-session:";

let memoryToken: string | null = null;

/**
 * `window.name` sobrevive a recarregamentos e navegações dentro da mesma aba,
 * mesmo quando o navegador bloqueia cookies e armazenamento local. É o último
 * recurso antes de recorrer ao `#` da URL.
 */
function readWindowName(): string | null {
  try {
    const value = window.name ?? "";
    return value.startsWith(WINDOW_NAME_PREFIX) ? value.slice(WINDOW_NAME_PREFIX.length) || null : null;
  } catch {
    return null;
  }
}

function writeWindowName(token: string | null): boolean {
  try {
    if (token) {
      window.name = WINDOW_NAME_PREFIX + token;
      return true;
    }
    if ((window.name ?? "").startsWith(WINDOW_NAME_PREFIX)) window.name = "";
  } catch {
    /* propriedade bloqueada: segue sem esse recurso */
  }
  return false;
}

function storage(kind: "local" | "session"): Storage | null {
  try {
    const s = kind === "local" ? window.localStorage : window.sessionStorage;
    s.setItem(TOKEN_KEY, s.getItem(TOKEN_KEY) ?? "");
    s.removeItem(TOKEN_KEY);
    if (s.getItem(TOKEN_KEY)) s.removeItem(TOKEN_KEY);
    return s;
  } catch {
    return null;
  }
}

function tokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.hash.match(/(?:^#|&)t=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Token atual: memória → armazenamento → `#t=` da URL. */
export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  const fromName = readWindowName();
  if (fromName) return (memoryToken = fromName);
  for (const kind of ["local", "session"] as const) {
    const value = storage(kind)?.getItem(TOKEN_KEY);
    if (value) return (memoryToken = value);
  }
  const fromHash = tokenFromHash();
  if (fromHash) return (memoryToken = fromHash);
  return null;
}

/** Guarda o token. Devolve `true` se algum armazenamento aceitou persistir. */
export function setToken(token: string | null): boolean {
  memoryToken = token;
  let persisted = writeWindowName(token);
  for (const kind of ["local", "session"] as const) {
    const s = storage(kind);
    if (!s) continue;
    try {
      if (token) {
        s.setItem(TOKEN_KEY, token);
        persisted = true;
      } else {
        s.removeItem(TOKEN_KEY);
      }
    } catch {
      /* armazenamento cheio ou bloqueado: tenta o próximo */
    }
  }
  return persisted;
}

/**
 * Lê o token do `#` da URL (usado quando o armazenamento está bloqueado),
 * guarda onde der e limpa a URL se conseguiu persistir. Devolve o token.
 */
export function adoptTokenFromUrl(): string | null {
  const fromHash = tokenFromHash();
  if (!fromHash) return getToken();
  const persisted = setToken(fromHash);
  if (persisted) {
    try {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    } catch {
      /* sem History API: mantém o hash, que é inofensivo */
    }
  }
  return fromHash;
}

/**
 * Sem armazenamento disponível, mantém o token no `#` da URL para que um
 * recarregamento da página continue autenticado. Se algum armazenamento
 * guardou o token, a URL fica limpa.
 */
export function keepTokenInUrl(): void {
  const token = getToken();
  if (!token) return;
  if (readWindowName() === token) return;
  for (const kind of ["local", "session"] as const) {
    if (storage(kind)?.getItem(TOKEN_KEY) === token) return;
  }
  try {
    if (!tokenFromHash()) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}#t=${encodeURIComponent(token)}`,
      );
    }
  } catch {
    /* sem History API: segue com o token só em memória */
  }
}

function withToken(url: string, token: string | null): string {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${encodeURIComponent(token)}`;
}

/** Fotos de usuários só são servidas a sessões válidas; nunca adiciona token a domínio externo. */
export function authorizedAssetUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return "";
  return withToken(path, getToken());
}

export async function api<T = unknown>(
  url: string,
  opts: { method?: string; body?: unknown; redirectOn401?: boolean; signal?: AbortSignal } = {},
): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(withToken(url, token), {
      method: opts.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-tem-client": "1",
        ...(token ? { authorization: `Bearer ${token}`, "x-tem-session": token } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") {
      throw new HttpError(408, "Tempo esgotado ao falar com o servidor.");
    }
    throw new HttpError(0, "Sem conexão com o servidor. Verifique a rede e tente de novo.");
  }
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) {
    setToken(null);
    if (opts.redirectOn401 !== false) window.location.replace("/login");
  }
  if (!res.ok) {
    throw new HttpError(res.status, data?.error ?? "Não foi possível concluir a operação.");
  }
  const method = (opts.method ?? "GET").toUpperCase();
  if (typeof window !== "undefined" && method !== "GET" && /^\/api\/(batches|stock|shipments|admin\/(products|data|settings|columns))/.test(url)) {
    window.dispatchEvent(new Event("tem:data-changed"));
  }
  return data as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");

export const packLabel = (label: string, units: number) => `${label} c/ ${units}`;

/* ───────────── Datas e números ───────────── */

const two = (n: number) => String(n).padStart(2, "0");

export const fmtInt = (n: number) => n.toLocaleString("pt-BR");

/** 12/03/2026 14:32 */
export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** 12/03/2026 14:32:07 — usado no carimbo de liberação. */
export function fmtDateTimeSec(iso: string): string {
  return `${fmtDateTime(iso)}:${two(new Date(iso).getSeconds())}`;
}

/** 12/03 14:32 */
export function fmtShort(iso: string): string {
  const d = new Date(iso);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "há 12 min", "há 3 h", "há 2 d" */
export function fmtAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `há ${hours} h`;
  return `há ${Math.round(hours / 24)} d`;
}

/** "1 h 20 min" entre dois instantes. */
export function fmtDuration(startIso: string, endIso: string): string {
  const minutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  if (minutes < 0) return "—";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** ISO → valor de <input type="datetime-local"> no fuso do navegador. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

export function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
