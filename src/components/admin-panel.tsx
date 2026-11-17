"use client";

import { usePageLoading } from "@/components/splash-provider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Crown, Database, Eye, Folder, ImagePlus, Layers, Package, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import {
  ADMIN_CAPABILITIES,
  ADMIN_CAPABILITY_META,
  hasAdminCapability,
  isMasterAdmin,
  isReadOnly,
  type AdminCapability,
  type AdminOverviewDTO,
  type SessionUser,
} from "@/lib/domain";
import { api, errMsg, fmtShort } from "@/lib/client";
import { Button, cn, ErrorNote, PanelCard as Card, SectionTitle, Switch, useToast } from "@/components/ui";
import { ProductsTab } from "@/components/products-tab";
import { ColumnsTab } from "@/components/columns-tab";
import { ProfilesTab } from "@/components/profiles-tab";
import { BrandingPanel } from "@/components/branding-panel";
import { UsersTab } from "@/components/users-tab";
import { DataMaintenance } from "@/components/data-maintenance";

type Tab = "produtos" | "painéis" | "perfis" | "usuarios" | "drive" | "visual" | "dados" | "limites";
type Run = (fn: () => Promise<unknown>, okMessage?: string) => Promise<boolean>;

const TABS: Array<{
  id: Tab;
  label: string;
  icon: typeof Package;
  cap?: AdminCapability;
  masterOnly?: boolean;
}> = [
  { id: "produtos", label: "Produtos e classificações", icon: Package, cap: "admin_produtos" },
  { id: "painéis", label: "Painéis do quadro", icon: Layers, cap: "admin_paineis" },
  { id: "perfis", label: "Perfis de acesso", icon: ShieldCheck, cap: "admin_perfis" },
  { id: "usuarios", label: "Usuários", icon: Users, cap: "admin_usuarios" },
  { id: "drive", label: "Google Drive", icon: Folder, cap: "admin_drive" },
  { id: "visual", label: "Identidade visual", icon: ImagePlus, cap: "admin_visual" },
  { id: "dados", label: "Dados do sistema", icon: Database, cap: "admin_dados" },
  { id: "limites", label: "Limites de Admin", icon: SlidersHorizontal, masterOnly: true },
];

export function AdminPanel({ me, initialSection }: { me: SessionUser; initialSection?: string }) {
  const toast = useToast();
  const readOnly = isReadOnly(me.role);
  const master = isMasterAdmin(me.role);
  const [data, setData] = useState<AdminOverviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageLoading(data === null && error === null);

  const visibleTabs = useMemo(
    () =>
      TABS.filter((t) => {
        if (readOnly || master) return true;
        if (t.masterOnly) return false;
        return !t.cap || hasAdminCapability(me, t.cap);
      }),
    [me, master, readOnly],
  );

  const [tab, setTab] = useState<Tab>(() => {
    const allowed = TABS.filter((t) => {
      if (readOnly || master) return true;
      if (t.masterOnly) return false;
      return !t.cap || hasAdminCapability(me, t.cap);
    });
    if (initialSection && allowed.some((t) => t.id === initialSection)) return initialSection as Tab;
    return allowed[0]?.id ?? "produtos";
  });

  const activeTab = visibleTabs.some((t) => t.id === tab) ? tab : (visibleTabs[0]?.id ?? "produtos");

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
      if (readOnly) {
        toast("Modo visualização (somente leitura): alterações não podem ser salvas.", "error");
        return false;
      }
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
    [load, toast, readOnly],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-3 pb-12 pt-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Gestão</p>
            <h1 className="display mt-1.5 text-[34px]">Painel Admin</h1>
          </div>
          {master && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink bg-ink px-3 py-1.5 text-xs font-bold text-hivis">
              <Crown aria-hidden className="size-3.5" />
              Administrador Master · controle completo
            </span>
          )}
          {!master && !readOnly && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-semibold text-ink-2">
              <ShieldCheck aria-hidden className="size-3.5 text-prod" />
              Administrador padrão · limites definidos pelo Master
            </span>
          )}
          {readOnly && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-qual/30 bg-qual-soft px-3 py-1.5 text-xs font-bold text-qual">
              <Eye aria-hidden className="size-3.5" />
              Somente leitura (demonstração)
            </span>
          )}
        </div>

        {readOnly && (
          <p className="mt-3 rounded-lg border border-qual/25 bg-qual-soft/70 px-3 py-2.5 text-xs font-medium text-qual">
            Todas as abas e formulários podem ser abertos para demonstração, mas nenhuma criação, edição ou exclusão pode ser salva.
          </p>
        )}

        <div role="tablist" aria-label="Seções do painel" className="mt-5 flex gap-1.5 overflow-x-auto border-b border-ink/15 pb-px">
          {visibleTabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={activeTab === id}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px flex h-11 shrink-0 items-center gap-2 border-b-[3px] px-3 text-sm font-semibold transition",
                activeTab === id ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} className="mt-5">
          {error && !data && <ErrorNote>{error}</ErrorNote>}
          {!data && !error && (
            <div aria-hidden className="space-y-3">
              <div className="h-28 animate-pulse rounded-xl bg-ink/8" />
              <div className="h-52 animate-pulse rounded-xl bg-ink/8" />
            </div>
          )}
          {data && activeTab === "produtos" && (
            <ProductsTab
              products={data.products}
              dimensions={data.dimensions}
              allowMultiFormatBatch={data.allowMultiFormatBatch}
              readOnly={readOnly}
              run={run}
            />
          )}
          {data && activeTab === "painéis" && (
            <ColumnsTab columns={data.columns} allowMultiFormatBatch={data.allowMultiFormatBatch} readOnly={readOnly} run={run} />
          )}
          {data && activeTab === "perfis" && <ProfilesTab profiles={data.profiles} readOnly={readOnly} run={run} />}
          {data && activeTab === "usuarios" && <UsersTab users={data.users} profiles={data.profiles} me={me} onChanged={load} />}
          {data && activeTab === "drive" && <DriveTab drive={data.drive} />}
          {data && activeTab === "visual" && <BrandingPanel />}
          {data && activeTab === "dados" && <DataMaintenance onChanged={load} />}
          {data && activeTab === "limites" && (
            <AdminLimitsTab
              capabilities={data.adminLimits.capabilities}
              readOnly={readOnly || !master}
              run={run}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Limites dos administradores padrão (exclusivo Admin Master) ───────────── */

function AdminLimitsTab({
  capabilities,
  readOnly,
  run,
}: {
  capabilities: AdminCapability[];
  readOnly: boolean;
  run: Run;
}) {
  const [draft, setDraft] = useState<AdminCapability[]>(capabilities);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(capabilities);
  }, [capabilities]);

  const toggle = (cap: AdminCapability) => {
    setDraft((cur) => (cur.includes(cap) ? cur.filter((c) => c !== cap) : [...cur, cap]));
  };

  const changed =
    draft.length !== capabilities.length ||
    draft.some((c) => !capabilities.includes(c));

  async function save() {
    if (readOnly) return;
    setBusy(true);
    await run(
      () => api("/api/admin/settings", { method: "PATCH", body: { adminLimits: { capabilities: draft } } }),
      "Limites dos administradores padrão atualizados.",
    );
    setBusy(false);
  }

  const adminCaps = ADMIN_CAPABILITIES.filter((c) => ADMIN_CAPABILITY_META[c].group === "admin");
  const systemCaps = ADMIN_CAPABILITIES.filter((c) => ADMIN_CAPABILITY_META[c].group === "sistema");

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionTitle>Limites para administradores padrão</SectionTitle>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-2">
              Defina exatamente o que contas com perfil <strong>Administrador</strong> podem ver e executar. O{" "}
              <strong>Administrador Master</strong> mantém acesso irrestrito e nunca sofre bloqueios. Contas de administrador
              padrão nunca podem alterar ou excluir contas de ADM ou Master.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly || busy}
              onClick={() => setDraft([...ADMIN_CAPABILITIES])}
            >
              Liberar tudo
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={readOnly || busy}
              onClick={() => setDraft(["admin_produtos", "admin_drive", "operar_fluxo"])}
            >
              Operação restrita
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Abas e funções do Painel Admin</SectionTitle>
          <ul className="space-y-2.5">
            {adminCaps.map((cap) => {
              const meta = ADMIN_CAPABILITY_META[cap];
              const on = draft.includes(cap);
              return (
                <li key={cap} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{meta.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{meta.description}</p>
                  </div>
                  <Switch checked={on} label={meta.label} disabled={readOnly || busy} onChange={() => toggle(cap)} />
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <SectionTitle>Ações operacionais no sistema</SectionTitle>
          <ul className="space-y-2.5">
            {systemCaps.map((cap) => {
              const meta = ADMIN_CAPABILITY_META[cap];
              const on = draft.includes(cap);
              return (
                <li key={cap} className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{meta.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{meta.description}</p>
                  </div>
                  <Switch checked={on} label={meta.label} disabled={readOnly || busy} onChange={() => toggle(cap)} />
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3">
        <p className="text-xs text-ink-3">
          {draft.length} de {ADMIN_CAPABILITIES.length} permissão(ões) habilitadas para administradores padrão.
          {changed && " Há alterações não salvas."}
        </p>
        <Button
          variant="hivis"
          loading={busy}
          disabled={readOnly || !changed}
          icon={<CheckCircle2 aria-hidden className="size-4" />}
          onClick={() => void save()}
        >
          Salvar limites dos admins
        </Button>
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
