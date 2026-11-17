"use client";

import { useEffect, useState, type FormEvent } from "react";
import { usePageLoading } from "@/components/splash-provider";
import { api, adoptTokenFromUrl, getToken, errMsg, setToken } from "@/lib/client";
import { Button, ErrorNote, Field, inputCls } from "@/components/ui";

export function LoginForm({ expired = false }: { expired?: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingSession, setCheckingSession] = useState(false);
  usePageLoading(busy || checkingSession);
  const [error, setError] = useState<string | null>(null);

  // Caso o cookie tenha sido bloqueado (ex.: iframe), confere se há token local válido.
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    adoptTokenFromUrl();
    if (!getToken()) return;
    setCheckingSession(true);
    const timer = setTimeout(() => controller.abort(), 10_000);
    api<{ user: unknown | null; clearClientToken?: boolean }>("/api/auth/me", {
      redirectOn401: false,
      signal: controller.signal,
    })
      .then((res) => {
        if (!alive) return;
        if (res.clearClientToken) setToken(null);
        if (res.user) {
          window.location.replace("/");
          return;
        }
        setToken(null);
        setCheckingSession(false);
      })
      .catch(() => {
        setToken(null);
        if (alive) setCheckingSession(false);
      })
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
        redirectOn401: false,
      });
      const persisted = setToken(res.token);
      const check = await api<{ user: unknown | null }>("/api/auth/me", { redirectOn401: false });
      if (!check.user) {
        setToken(null);
        setError("O login foi aceito, mas o navegador não manteve a sessão. Abra o sistema em uma nova aba e entre de novo.");
        setBusy(false);
        return;
      }
      window.location.replace(persisted ? "/" : `/#t=${encodeURIComponent(res.token)}`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {expired && !error && (
        <p className="rounded-lg bg-prod-soft px-3 py-2.5 text-sm text-prod">Você saiu ou a sessão anterior terminou. Entre novamente.</p>
      )}
      <Field label="E-mail">
        <input
          className={inputCls}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@alimentostem.com.br"
        />
      </Field>
      <Field label="Senha">
        <input
          className={inputCls}
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <ErrorNote>{error}</ErrorNote>
      {error && /nova aba/.test(error) && (
        <a
          href="/login"
          target="_blank"
          rel="noreferrer"
          className="flex h-11 items-center justify-center rounded-lg border border-ink/25 bg-white text-sm font-semibold text-ink transition hover:border-ink"
        >
          Abrir o sistema em uma nova aba
        </a>
      )}

      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={busy || !email || !password}>
        Entrar
      </Button>
      <p className="text-center text-xs text-ink-3">Acesso apenas com usuário e senha cadastrados pelo gestor.</p>
    </form>
  );
}
