import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { STAGE_META, STAGES } from "@/lib/domain";
import { ensureReady } from "@/lib/seed";
import { AppFooter } from "@/components/app-footer";
import { LoginForm } from "@/components/login-form";
import { Logo } from "@/components/top-bar";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

const SETUP_HELP = {
  schema: {
    title: "Banco de dados precisa aplicar ou atualizar o schema",
    body: "Execute a migração e aplique o schema uma vez no PostgreSQL e recarregue esta página:",
    code: "npm run db:migrate && npx drizzle-kit push",
  },
  admin_env: {
    title: "Defina o primeiro administrador",
    body: "Em um banco vazio, configure o primeiro administrador nas variáveis abaixo (senha com 8+ caracteres) e recarregue:",
    code: "ADMIN_EMAIL=...  ADMIN_PASSWORD=...",
  },
  db: {
    title: "Não foi possível conectar ao banco",
    body: "Confira a variável de ambiente e se o banco está acessível:",
    code: "DATABASE_URL=postgresql://...",
  },
} as const;

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  const state = await ensureReady();
  const user = state.ok ? await getSessionUser() : null;
  if (user) redirect("/");

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr] lg:grid-rows-[1fr_auto]">
      <aside className="on-dark relative flex flex-col justify-between gap-10 overflow-hidden bg-ink px-6 py-7 text-paper sm:px-10 lg:py-10">
        <div aria-hidden className="absolute -right-10 top-0 h-full w-24 -skew-x-12 bg-hivis/90 max-lg:hidden" />
        <Logo />
        <div className="relative max-w-lg">
          <h1 className="display text-[clamp(2.25rem,5.2vw,4.25rem)] leading-[0.92]">
            Da batelada
            <br />à expedição,
            <br />
            <span className="text-hivis">em um só painel.</span>
          </h1>
          <ol className="mt-8 grid max-w-md grid-cols-2 gap-x-6 gap-y-4 max-lg:hidden">
            {STAGES.map((stage, i) => (
              <li key={stage} className="border-t border-paper/25 pt-2.5">
                <span className="font-mono text-[11px] text-hivis">0{i + 1}</span>
                <p className="mt-0.5 text-[15px] font-semibold">{STAGE_META[stage].title}</p>
                <p className="text-[13px] text-paper/65">{STAGE_META[stage].subtitle}</p>
              </li>
            ))}
          </ol>
        </div>
        <p className="relative text-xs text-paper/50 max-lg:hidden">Sistema de Gestão de Produção e Logística · Alimentos TEM</p>
      </aside>

      <main className="mat flex items-start justify-center px-4 py-8 sm:px-8 lg:items-center">
        <div className="w-full max-w-md">
          {state.ok ? (
            <>
              <h2 className="display text-[30px]">Entrar no sistema</h2>
              <p className="mb-6 mt-1.5 text-sm text-ink-2">Use o e-mail e a senha cadastrados pelo gestor.</p>
              <LoginForm expired={expired === "1"} />
            </>
          ) : (
            <div className="rounded-xl border border-ink/20 bg-card p-5">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-prod">Configuração pendente</p>
              <h2 className="display mt-2 text-[26px]">{SETUP_HELP[state.reason].title}</h2>
              <p className="mt-2 text-sm text-ink-2">{SETUP_HELP[state.reason].body}</p>
              <pre className="mt-3 overflow-x-auto rounded-lg bg-ink px-3 py-2.5 font-mono text-[13px] text-hivis">
                {SETUP_HELP[state.reason].code}
              </pre>
            </div>
          )}
        </div>
      </main>
      <div className="col-span-full">
        <AppFooter />
      </div>
    </div>
  );
}
