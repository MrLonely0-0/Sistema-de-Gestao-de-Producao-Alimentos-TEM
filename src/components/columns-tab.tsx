"use client";

import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import {
  ACCENTS,
  ACCENT_LABEL,
  COLUMN_FEATURES,
  FEATURE_LABEL,
  ROLE_LABEL,
  ROLES,
  STATUSES,
  STATUS_LABEL,
  type Accent,
  type ColumnDTO,
  type ColumnFeature,
  type Role,
  type Status,
} from "@/lib/domain";
import { api } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal, PanelCard, SectionTitle, StatusPill, Switch, useToast, ACCENT_STYLE } from "@/components/ui";
import { MultiFormatSettingCard, type Run } from "@/components/products-tab";

type Dialog = { kind: "create" } | { kind: "edit"; column: ColumnDTO } | { kind: "delete"; column: ColumnDTO } | null;

export function ColumnsTab({
  columns,
  allowMultiFormatBatch,
  run,
}: {
  columns: ColumnDTO[];
  allowMultiFormatBatch: boolean;
  run: Run;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(column: ColumnDTO, direction: -1 | 1) {
    const order = columns.map((c) => c.id);
    const i = order.indexOf(column.id);
    const j = i + direction;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await run(() => api("/api/admin/columns", { method: "PATCH", body: { order } }));
  }

  async function save(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError(null);
    const done = await run(
      () => api("/api/admin/columns", { method: dialog?.kind === "edit" ? "PATCH" : "POST", body }),
      ok,
    );
    setBusy(false);
    if (done) setDialog(null);
  }

  async function remove(column: ColumnDTO) {
    setBusy(true);
    setError(null);
    const done = await run(() => api(`/api/admin/columns?id=${column.id}`, { method: "DELETE" }), `Painel ${column.name} excluído.`);
    setBusy(false);
    if (done) setDialog(null);
  }

  return (
    <div className="space-y-5">
      <MultiFormatSettingCard allowMultiFormatBatch={allowMultiFormatBatch} run={run} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <SectionTitle>Painéis ativos</SectionTitle>
          <p className="max-w-2xl text-xs text-ink-3">
            Cada painel é uma coluna do quadro. Você pode criar, renomear, excluir, mudar a ordem, escolher a cor, o perfil responsável,
            quais status aparecem nele e quais funcionalidades ficam habilitadas. Desligar uma funcionalidade bloqueia a ação também no servidor.
          </p>
        </div>
        <Button variant="hivis" icon={<Plus aria-hidden className="size-4" />} onClick={() => setDialog({ kind: "create" })}>
          Novo painel
        </Button>
      </div>

      <div className="space-y-3">
        {columns.map((c, i) => {
          const style = ACCENT_STYLE[c.accent] ?? ACCENT_STYLE.ink;
          return (
            <PanelCard key={c.id} className={cn(!c.active && "bg-paper-deep/50")}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    aria-label={`Mover ${c.name} para a esquerda`}
                    disabled={i === 0}
                    onClick={() => void move(c, -1)}
                    className="grid size-9 place-items-center rounded-lg border border-ink/20 bg-white transition hover:border-ink disabled:opacity-30"
                  >
                    <ArrowUp aria-hidden className="size-4 -rotate-90" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Mover ${c.name} para a direita`}
                    disabled={i === columns.length - 1}
                    onClick={() => void move(c, 1)}
                    className="grid size-9 place-items-center rounded-lg border border-ink/20 bg-white transition hover:border-ink disabled:opacity-30"
                  >
                    <ArrowDown aria-hidden className="size-4 -rotate-90" />
                  </button>
                </div>
                <span aria-hidden className={cn("mt-1 h-10 w-1.5 shrink-0 rounded-full", style.bar)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="display text-[22px]">{c.name}</h3>
                    <span className="text-xs text-ink-3">{c.subtitle}</span>
                    {c.showStock && <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase text-hivis">saldo de estoque</span>}
                    <span className="tnum text-xs text-ink-3">{c.cardCount} cards</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-bold uppercase tracking-wide text-ink-3">Status:</span>
                    {c.statuses.map((s) => (
                      <StatusPill key={s} status={s} />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {c.features.map((f) => (
                      <span key={f} className="rounded bg-paper-deep px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
                        {FEATURE_LABEL[f]}
                      </span>
                    ))}
                    {c.features.length === 0 && <span className="text-xs text-stop">Nenhuma funcionalidade habilitada</span>}
                  </div>
                  <p className="mt-2 text-xs text-ink-3">
                    Responsável: <strong className="text-ink-2">{ROLE_LABEL[c.role]}</strong> · Cor: {ACCENT_LABEL[c.accent as Accent] ?? c.accent}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={c.active}
                    label={`Painel ${c.name} ativo`}
                    onChange={(active) => void run(() => api("/api/admin/columns", { method: "PATCH", body: { id: c.id, active } }))}
                  />
                  <button
                    type="button"
                    aria-label={`Editar painel ${c.name}`}
                    onClick={() => setDialog({ kind: "edit", column: c })}
                    className="grid size-9 place-items-center rounded-lg text-ink-3 transition hover:bg-ink/8 hover:text-ink"
                  >
                    <Pencil aria-hidden className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Excluir painel ${c.name}`}
                    onClick={() => setDialog({ kind: "delete", column: c })}
                    className="grid size-9 place-items-center rounded-lg text-ink-3 transition hover:bg-stop-soft hover:text-stop"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </button>
                </div>
              </div>
            </PanelCard>
          );
        })}
        {columns.length === 0 && (
          <p className="rounded-xl border border-dashed border-ink/25 px-4 py-8 text-center text-sm text-ink-3">Nenhum painel cadastrado.</p>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-ink-3">
        <Layers aria-hidden className="size-3.5" />
        Mudanças aparecem no quadro imediatamente ao recarregar (ou em até 8 segundos, pela atualização automática).
      </p>

      {(dialog?.kind === "create" || dialog?.kind === "edit") && (
        <ColumnFormDialog
          column={dialog.kind === "edit" ? dialog.column : undefined}
          busy={busy}
          error={error}
          onClose={() => setDialog(null)}
          onSubmit={(body) => void save(body, dialog.kind === "edit" ? `Painel ${body.name} atualizado.` : `Painel ${body.name} criado.`)}
        />
      )}
      {dialog?.kind === "delete" && (
        <Modal
          eyebrow="Admin · painéis"
          title={`Excluir "${dialog.column.name}"?`}
          onClose={() => setDialog(null)}
          width="max-w-lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void remove(dialog.column)}>
                Excluir painel
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-2">
            O painel sai do quadro. Para excluir, todos os status dele precisam estar em outro painel ativo — mova-os antes se o sistema avisar.
            As bateladas não são apagadas.
          </p>
          <ErrorNote>{error}</ErrorNote>
        </Modal>
      )}
    </div>
  );
}

function ColumnFormDialog({
  column,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  column?: ColumnDTO;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(column?.name ?? "");
  const [subtitle, setSubtitle] = useState(column?.subtitle ?? "");
  const [accent, setAccent] = useState<Accent>(column?.accent ?? "ink");
  const [role, setRole] = useState<Role>(column?.role ?? "producao");
  const [statuses, setStatuses] = useState<Status[]>(column?.statuses ?? []);
  const [features, setFeatures] = useState<ColumnFeature[]>(column?.features ?? []);
  const [showStock, setShowStock] = useState(column?.showStock ?? false);
  const [active, setActive] = useState(column?.active ?? true);

  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void) =>
    set(list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({
      ...(column ? { id: column.id } : {}),
      name,
      subtitle,
      accent,
      role,
      statuses,
      features,
      showStock,
      active,
    });
  }

  return (
    <Modal
      eyebrow="Admin · painéis do quadro"
      title={column ? `Editar ${column.name}` : "Novo painel"}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="column-form" loading={busy} disabled={!name.trim()}>
            Salvar painel
          </Button>
        </>
      }
    >
      <form id="column-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome do painel">
            <input className={inputCls} autoFocus value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Subtítulo" optional>
            <input className={inputCls} value={subtitle} maxLength={50} onChange={(e) => setSubtitle(e.target.value)} />
          </Field>
          <Field label="Cor">
            <select className={inputCls} value={accent} onChange={(e) => setAccent(e.target.value as Accent)}>
              {ACCENTS.map((a) => (
                <option key={a} value={a}>
                  {ACCENT_LABEL[a]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Perfil responsável">
            <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <fieldset>
          <legend className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Status que aparecem neste painel</legend>
          <div className="flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={statuses.includes(s)}
                onClick={() => toggle(statuses, s, setStatuses)}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-lg border-2 px-2.5 text-xs font-bold transition",
                  statuses.includes(s) ? "border-ink bg-ink text-paper" : "border-ink/20 bg-white text-ink hover:border-ink",
                )}
              >
                <StatusPill status={s} className={statuses.includes(s) ? "bg-transparent text-paper" : ""} />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Funcionalidades habilitadas</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {COLUMN_FEATURES.map((f) => (
              <label key={f} className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition", features.includes(f) ? "border-ink bg-card" : "border-line bg-white text-ink-2")}>
                <input type="checkbox" className="size-4 accent-ink" checked={features.includes(f)} onChange={() => toggle(features, f, setFeatures)} />
                {FEATURE_LABEL[f]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-line bg-card px-3 py-2">
          <Switch checked={showStock} label="Mostrar saldo de estoque neste painel" onChange={setShowStock} />
          <Switch checked={active} label="Painel ativo" onChange={setActive} />
        </div>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}
