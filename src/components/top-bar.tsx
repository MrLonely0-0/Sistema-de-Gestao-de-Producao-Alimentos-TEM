"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BarChart3,
  Boxes,
  LayoutGrid,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Settings,
} from "lucide-react";
import { ROLE_LABEL, type SessionUser } from "@/lib/domain";
import { api, setToken } from "@/lib/client";
import { cn } from "@/components/ui";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="display grid h-9 place-items-center rounded-md bg-hivis px-2 text-[24px] text-ink">
        TEM
      </span>
      <span className="leading-none">
        <span className="block text-[10px] font-bold uppercase tracking-[0.2em] opacity-70">
          Alimentos
        </span>
        <span className="mt-1 block text-[13px] font-semibold">
          Produção &amp; Logística
        </span>
      </span>
    </span>
  );
}

export function TopBar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [leaving, setLeaving] = useState(false);

  async function logout() {
    setLeaving(true);
    try {
      await api("/api/auth/logout", { method: "POST", redirectOn401: false });
    } finally {
      setToken(null);
      window.location.href = "/login";
    }
  }

  const [chatTitle, setChatTitle] = useState("Chat");
  useEffect(() => {
    api<{ title: string }>("/api/chat/title", { redirectOn401: false })
      .then((r) => setChatTitle(r.title))
      .catch(() => undefined);
  }, []);

  const links = [
    { href: "/", label: "Painel", icon: LayoutGrid, show: true },
    { href: "/relatorios", label: "Relatórios", icon: BarChart3, show: true },
    { href: "/estoque", label: "Estoque", icon: Boxes, show: true },
    { href: "/chat", label: chatTitle, icon: MessageSquare, show: true },
    {
      href: "/admin",
      label: "Admin",
      icon: Settings,
      show: user.role === "admin",
    },
  ].filter((l) => l.show);

  return (
    <header className="on-dark flex h-14 shrink-0 items-center gap-2 bg-ink px-3 text-paper sm:gap-4 sm:px-5">
      <Link
        href="/"
        aria-label="Alimentos TEM — ir para o painel"
        className="rounded-md"
      >
        <Logo className="[&>span:last-child]:hidden sm:[&>span:last-child]:block" />
      </Link>

      <nav aria-label="Principal" className="flex items-center gap-1">
        {links.map(({ href, label, icon: Icon }) => {
          const current =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold transition",
                current
                  ? "bg-paper/15 text-paper"
                  : "text-paper/70 hover:bg-paper/10 hover:text-paper",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
        <div className="min-w-0 text-right leading-tight">
          <p className="hidden truncate text-[13px] font-semibold sm:block">
            {user.name}
          </p>
          <p className="truncate text-[11px] font-semibold text-hivis sm:font-medium">
            {ROLE_LABEL[user.role]}
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          disabled={leaving}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-paper/25 px-2.5 text-[13px] font-semibold text-paper transition hover:bg-paper/10 disabled:opacity-50"
        >
          {leaving ? (
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
          ) : (
            <LogOut aria-hidden className="size-4" />
          )}
          <span className="hidden sm:inline">Sair</span>
          <span className="sr-only sm:hidden">Sair</span>
        </button>
      </div>
    </header>
  );
}
