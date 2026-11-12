"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import type { SessionUser } from "@/lib/domain";
import { adoptTokenFromUrl, api, getToken, keepTokenInUrl, setToken } from "@/lib/client";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui";

const AuthContext = createContext<SessionUser | null>(null);

/** Usuário logado, disponível para qualquer componente dentro de AppGate. */
export function useAuth(): SessionUser {
  const user = useContext(AuthContext);
  if (!user) throw new Error("useAuth() só pode ser usado dentro de AppGate.");
  return user;
}

function Splash({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <span className="display grid h-11 place-items-center rounded-md bg-hivis px-2.5 text-[28px] text-ink">TEM</span>
        <p className="flex items-center gap-2 text-sm text-ink-2">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * Porteiro da aplicação. A sessão é conferida no navegador, com o token que
 * pode vir do armazenamento ou do `#` da URL — assim o sistema abre mesmo
 * quando o navegador bloqueia cookies e armazenamento (iframes, intranet,
 * painel de TV). O servidor valida o token em cada requisição.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [state, setState] = useState<"checking" | "in" | "offline">("checking");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("checking");

    // Token que chegou pela URL (quando o armazenamento está bloqueado).
    adoptTokenFromUrl();

    if (!getToken()) {
      setToken(null);
      router.replace("/login");
      return;
    }

    api<{ user: SessionUser | null }>("/api/auth/me", { redirectOn401: false })
      .then((res) => {
        if (!alive) return;
        if (res.user) {
          setUser(res.user);
          setState("in");
          keepTokenInUrl();
          return;
        }
        setToken(null);
        router.replace("/login?expired=1");
      })
      .catch((error: unknown) => {
        if (!alive) return;
        // 401 já foi tratado em api(); aqui só resta falha de rede/servidor.
        const status = (error as { status?: number }).status;
        if (status === 401) {
          setToken(null);
          router.replace("/login?expired=1");
          return;
        }
        setState("offline");
      });

    return () => {
      alive = false;
    };
  }, [router, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state === "in" && user) {
    return (
      <AuthContext.Provider value={user}>
        <div className="flex h-dvh flex-col">
          <TopBar user={user} />
          <main className="mat min-h-0 flex-1">{children}</main>
        </div>
      </AuthContext.Provider>
    );
  }

  if (state === "offline") {
    return (
      <Splash label="Não foi possível falar com o servidor.">
        <p className="text-xs text-ink-3">
          Seu login continua válido. Verifique a conexão e tente de novo.
        </p>
        <Button variant="outline" icon={<RefreshCw aria-hidden className="size-4" />} onClick={retry}>
          Tentar de novo
        </Button>
      </Splash>
    );
  }

  return <Splash label="Conferindo sua sessão…" />;
}
