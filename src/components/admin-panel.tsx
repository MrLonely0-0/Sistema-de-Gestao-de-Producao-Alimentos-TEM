"use client";

import { usePageLoading } from "@/components/splash-provider";

import { useCallback, useEffect, useState } from "react";
import { Database, Folder, ImagePlus, Layers, Package, ShieldCheck, Users } from "lucide-react";
import type { AdminOverviewDTO, SessionUser } from "@/lib/domain";
import { api, errMsg, fmtShort } from "@/lib/client";
import { cn, ErrorNote, PanelCard as Card, SectionTitle, useToast } from "@/components/ui";
import { ProductsTab } from "@/components/products-tab";
import { ColumnsTab } from "@/components/columns-tab";
import { ProfilesTab } from "@/components/profiles-tab";
import { BrandingPanel } from "@/components/branding-panel";
import { UsersTab } from "@/components/users-tab";
import { DataMaintenance } from "@/components/data-maintenance";

type Tab = "produtos" | "painéis" | "perfis" | "usuarios" | "drive" | "visual" | "dados";
type Run = (fn: () => Promise<unknown>, okMessage?: string) => Promise<boolean>;

const TABS: Array<{ id: Tab; label: string; icon: typeof Package }> = [
  { id: "produtos", label: "Produtos e classificações", icon: Package },
  { id: "painéis", label: "Painéis do quadro", icon: Layers },
  { id: "perfis", label: "Perfis de acesso", icon: ShieldCheck },
  { id: "usuarios", label: "Usuários", icon: Users },
  { id: "drive", label: "Google Drive", icon: Folder },
  { id: "visual", label: "Identidade visual", icon: ImagePlus },
  { id: "dados", label: "Dados do sistema", icon: Database },
];

export function AdminPanel({ me, initialSection }: { me: SessionUser; initialSection?: string }) {
  const toast = useToast();
  const [data, setData] = useState<AdminOverviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageLoading(data === null && error === null);
  const [tab, setTab] = useState<Tab>(() => TABS.some((t) => t.id === initialSection) ? initialSection as Tab : "produtos");

  const load = useCallback(async () => {
    try {
      setData(await api<AdminOverviewDTO>("/api/admin"));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run: Run = useCallback(
    async (fn, okMessage) => {
      try {
        await fn();
        if (okMessage) toast(okMessage);
        await load();
        return true;
      } catch (e) {
        toast(errMsg(e), "error");
        return false;
      }
    },
    [load, toast],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-3 pb-12 pt-5 sm:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Gestão</p>
        <h1 className="display mt-1.5 text-[34px]">Painel Admin</h1>

        <div role="tablist" aria-label="Seções do painel" className="mt-5 flex gap-1.5 overflow-x-auto border-b border-ink/15 pb-px">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px flex h-11 shrink-0 items-center gap-2 border-b-[3px] px-3 text-sm font-semibold transition",
                tab === id ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5">
          {error && !data && <ErrorNote>{error}</ErrorNote>}
          {!data && !error && (
            <div aria-hidden className="space-y-3">
              <div className="h-28 animate-pulse rounded-xl bg-ink/8" />
              <div className="h-52 animate-pulse rounded-xl bg-ink/8" />
            </div>
          )}
          {data && tab === "produtos" && <ProductsTab products={data.products} dimensions={data.dimensions} run={run} />}
          {data && tab === "painéis" && <ColumnsTab columns={data.columns} run={run} />}
          {data && tab === "perfis" && <ProfilesTab profiles={data.profiles} run={run} />}
          {data && tab === "usuarios" && <UsersTab users={data.users} profiles={data.profiles} me={me} onChanged={load} />}
          {data && tab === "drive" && <DriveTab drive={data.drive} />}
          {data && tab === "visual" && <BrandingPanel />}
          {data && tab === "dados" && <DataMaintenance onChanged={load} />}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Google Drive (simulado) ───────────── */

function DriveTab({ drive }: { drive: AdminOverviewDTO["drive"] }) {
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded bg-ink px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-hivis">Modo simulado</span>
          <p className="text-sm font-semibold">Nenhuma chamada sai para o Google nesta versão.</p>
        </div>
        <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-ink-2">
          Cada batelada nova ganha uma pasta dedicada (ID e caminho gerados pelo sistema) e os links de laudos e fotos
          ficam guardados nela. A estrutura é a mesma que a integração real usaria, então trocar o modo simulado pela API
          do Drive não muda nada nas telas.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-paper-deep/60 px-3 py-2.5">
            <dt className="text-xs text-ink-3">Pastas criadas</dt>
            <dd className="display tnum mt-1 text-[28px]">{drive.totalFolders}</dd>
          </div>
          <div className="rounded-lg bg-paper-deep/60 px-3 py-2.5">
            <dt className="text-xs text-ink-3">Links guardados</dt>
            <dd className="display tnum mt-1 text-[28px]">{drive.totalAttachments}</dd>
          </div>
          <div className="rounded-lg bg-paper-deep/60 px-3 py-2.5">
            <dt className="text-xs text-ink-3">Pasta raiz</dt>
            <dd className="mt-1.5 text-sm font-semibold">{drive.root}</dd>
          </div>
        </dl>
      </Card>

      <section>
        <SectionTitle>Pastas mais recentes</SectionTitle>
        {drive.folders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink/25 px-4 py-6 text-center text-sm text-ink-3">
            As pastas aparecem aqui conforme as bateladas são abertas.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
            {drive.folders.map((f) => (
              <li key={f.batchId} className="flex items-start gap-3 px-3 py-2.5">
                <Folder aria-hidden className="mt-0.5 size-4 shrink-0 text-prod" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold [overflow-wrap:anywhere]">{f.path}</p>
                  <p className="break-all font-mono text-[11px] text-ink-3">ID {f.folderId}</p>
                </div>
                <div className="shrink-0 text-right text-xs text-ink-3">
                  <p className="tnum font-semibold text-ink-2">
                    {f.attachments} {f.attachments === 1 ? "anexo" : "anexos"}
                  </p>
                  <p className="tnum">{fmtShort(f.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <SectionTitle>Para ligar o Drive de verdade</SectionTitle>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">
          <li>No Google Cloud, crie um projeto, ative a Drive API e gere uma conta de serviço (gratuito).</li>
          <li>Compartilhe a pasta raiz do Drive da empresa com o e-mail da conta de serviço, como Editor.</li>
          <li>
            Substitua a função <code className="rounded bg-paper-deep px-1 font-mono text-[13px]">createBatchFolder</code> em{" "}
            <code className="rounded bg-paper-deep px-1 font-mono text-[13px]">src/lib/drive.ts</code> pela chamada à API e guarde as
            credenciais em variáveis de ambiente. O passo a passo está no README.
          </li>
        </ol>
      </Card>
    </div>
  );
}
