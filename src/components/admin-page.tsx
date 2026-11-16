"use client";

import { SplashLink as Link } from "@/components/splash-provider";
import { ROLE_LABEL } from "@/lib/domain";
import { useAuth } from "@/components/auth-provider";
import { AdminPanel } from "@/components/admin-panel";

export function AdminPage({ initialSection }: { initialSection?: string }) {
  const user = useAuth();

  if (user.role !== "admin") {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md rounded-xl border border-ink/20 bg-card p-6 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-stop">Acesso restrito</p>
          <h1 className="display mt-2 text-[28px]">Área do administrador</h1>
          <p className="mt-2 text-sm text-ink-2">
            Seu perfil ({user.profileName ?? ROLE_LABEL[user.role] ?? "Perfil personalizado"}) não tem acesso ao Painel Admin. Peça ao gestor caso precise cadastrar
            produtos ou usuários.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex h-11 items-center rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition hover:bg-black"
          >
            Voltar ao painel
          </Link>
        </div>
      </div>
    );
  }

  return <AdminPanel me={user} initialSection={initialSection} />;
}
