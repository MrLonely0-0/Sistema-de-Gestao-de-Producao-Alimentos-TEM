"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { usePageLoading } from "@/components/splash-provider";
import { isReadOnly, type SessionUser } from "@/lib/domain";
import { adoptTokenFromUrl, api, getToken, keepTokenInUrl, setToken } from "@/lib/client";
import { TopBar } from "@/components/top-bar";
import { AppFooter } from "@/components/app-footer";
import { Button } from "@/components/ui";

const AuthContext = createContext<SessionUser | null>(null);
const AuthUpdateContext = createContext<((user: SessionUser) => void) | null>(null);

export function useUpdateAuth() {
  const update = useContext(AuthUpdateContext);
  if (!update) throw new Error("useUpdateAuth deve ser usado dentro do AppGate.");
  return update;
}

/** Usuário logado, disponível para qualquer componente dentro de AppGate. */
export function useAuth(): SessionUser {
  const user = useContext(AuthContext);
  if (!user) throw new Error("useAuth() só pode ser usado dentro de AppGate.");
  return user;
}

export function useReadOnly(): boolean {
  return isReadOnly(useAuth().role);
}

function Splash({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <span className="display rounded-md bg-hivis px-2.5 py-1.5 text-[25px] text-ink">TEM</span>
        <p className="flex items-center gap-2 text-sm text-ink-2">
          {label}
        </p>
        {children}
      </div>
    </div>
  );
}

/**
 * Porteiro da aplicação. Valida a sessão tanto por token do navegador
 * (localStorage/sessionStorage/window.name/#t=) quanto pelo cookie httpOnly
 * via /api/auth/me — evitando loop de redirecionamento entre `/` e `/login`.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [state, setState] = useState<"checking" | "in" | "redirecting" | "offline">("checking");
  const [attempt, setAttempt] = useState(0);
  usePageLoading(state === "checking");

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setState("checking");

    adoptTokenFromUrl();
    const hadClientToken = Boolean(getToken());

    const timeout = setTimeout(() => {
      controller.abort();
      if (alive) setState("offline");
    }, 25_000);

    api<{ user: SessionUser | null; clearClientToken?: boolean }>("/api/auth/me", {
      redirectOn401: false,
      signal: controller.signal,
    })
      .then((res) => {
        clearTimeout(timeout);
        if (!alive) return;
        if (res.clearClientToken) setToken(null);
        if (res.user) {
          setUser(res.user);
          setState("in");
          keepTokenInUrl();
          return;
        }
        setToken(null);
        setState("redirecting");
        window.location.replace(hadClientToken ? "/login?expired=1" : "/login");
      })
      .catch((error: unknown) => {
        clearTimeout(timeout);
        if (!alive) return;
        const status = (error as { status?: number }).status;
        if (status === 401) {
          setToken(null);
          setState("redirecting");
          window.location.replace(hadClientToken ? "/login?expired=1" : "/login");
          return;
        }
        setState("offline");
      });

    return () => {
      alive = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (state === "in" && user) {
    return (
      <AuthContext.Provider value={user}>
        <AuthUpdateContext.Provider value={setUser}>
        <div className="flex h-dvh flex-col">
          <TopBar user={user} />
          <main className="mat min-h-0 flex-1">{children}</main>
          <AppFooter />
        </div>
        </AuthUpdateContext.Provider>
      </AuthContext.Provider>
    );
  }

  if (state === "offline") {
    return (
      <Splash label="Não foi possível falar com o servidor.">
        <p className="text-xs text-ink-3">
          Não foi possível confirmar a sessão. Verifique a conexão e tente de novo.
        </p>
        <Button variant="outline" icon={<RefreshCw aria-hidden className="size-4" />} onClick={retry}>
          Tentar de novo
        </Button>
      </Splash>
    );
  }

  return <Splash label="Conferindo sua sessão…"><LoaderCircle aria-hidden className="size-5 animate-spin text-ink-3" /></Splash>;
}
