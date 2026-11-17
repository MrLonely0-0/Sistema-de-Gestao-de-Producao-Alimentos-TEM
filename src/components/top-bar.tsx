"use client";

import { SplashLink as Link } from "@/components/splash-provider";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Boxes, Eye, LayoutGrid, LoaderCircle, LogOut, MessageSquare, Settings } from "lucide-react";
import { canOpenAdmin, isReadOnly, ROLE_LABEL, type SessionUser } from "@/lib/domain";
import { api, setToken } from "@/lib/client";
import { cn } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="display grid h-9 place-items-center rounded-md bg-hivis px-2 text-[24px] text-ink">TEM</span>
      <span className="leading-none">
        <span className="block text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">Alimentos</span>
        <span className="mt-1 block text-[13px] font-semibold">Produção &amp; Logística</span>
      </span>
    </span>
  );
}

export function TopBar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);
  const [unread, setUnread] = useState(0);

  // Notificações: total de mensagens não lidas (canais + particulares).
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await api<{ total: number }>("/api/chat/unread", { redirectOn401: false });
        if (alive) setUnread(res.total);
      } catch {
        /* silencioso: o indicador não deve atrapalhar a navegação */
      }
    };
    void tick();
    const timer = window.setInterval(tick, 10000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [pathname]);

  async function logout() {
    setLeaving(true);
    try {
      await api("/api/auth/logout", { method: "POST", redirectOn401: false });
    } finally {
      setToken(null);
      window.location.href = "/login";
    }
  }

  const readOnly = isReadOnly(user.role);
  const links = [
    { href: "/", label: "Painel", icon: LayoutGrid, show: true },
    { href: "/relatorios", label: "Relatórios", icon: BarChart3, show: true },
    { href: "/estoque", label: "Estoque", icon: Boxes, show: true },
    { href: "/chat", label: "Conversa", icon: MessageSquare, show: true },
    { href: "/admin", label: "Admin", icon: Settings, show: canOpenAdmin(user) },
  ].filter((l) => l.show);

  return (
    <header className="on-dark flex h-14 shrink-0 items-center gap-2 bg-ink px-3 text-paper sm:gap-4 sm:px-5">
      <Link href="/" aria-label="Alimentos TEM — ir para o painel" className="rounded-md">
        <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:block" />
      </Link>

      <nav aria-label="Principal" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {links.map(({ href, label, icon: Icon }) => {
          const current = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition",
                current ? "bg-paper/15 text-paper" : "text-paper/70 hover:bg-paper/10 hover:text-paper",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
              {href === "/chat" && unread > 0 && (
                <span className="tnum ml-0.5 rounded bg-hivis px-1.5 text-[11px] font-bold text-ink" aria-label={`${unread} mensagens não lidas`}>
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        {readOnly && (
          <span className="hidden items-center gap-1 rounded-md border border-hivis/50 bg-hivis/15 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-hivis md:inline-flex">
            <Eye aria-hidden className="size-3.5" />
            Somente leitura
          </span>
        )}
        <Link href="/perfil" aria-label="Meu perfil" title="Editar meu perfil" className="flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-paper/10">
          <div className="hidden min-w-0 text-right leading-tight sm:block">
            <p className="truncate text-[13px] font-semibold">{user.name}</p>
            <p className="truncate text-[11px] text-hivis">{user.profileName ?? ROLE_LABEL[user.role]}</p>
          </div>
          <UserAvatar name={user.name} url={user.avatarUrl} className="size-8 bg-paper/15 text-paper" />
        </Link>
        <button
          type="button"
          onClick={logout}
          disabled={leaving}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-paper/25 px-2.5 text-[13px] font-semibold text-paper transition hover:bg-paper/10 disabled:opacity-50"
        >
          {leaving ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : <LogOut aria-hidden className="size-4" />}
          <span className="hidden sm:inline">Sair</span>
          <span className="sr-only sm:hidden">Sair</span>
        </button>
      </div>
    </header>
  );
}
