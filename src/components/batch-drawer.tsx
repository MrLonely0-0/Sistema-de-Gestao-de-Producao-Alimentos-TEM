"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, FileText, FolderOpen, Image as ImageIcon, Lock, ShieldAlert, Trash2, TriangleAlert, Undo2, UserRound } from "lucide-react";
import {
  can,
  canAttach,
  missingForReady,
  PROCESS_STEPS,
  ROLE_LABEL,
  roleLabel,
  STAGE_META,
  STAGE_OF,
  type AttachmentKind,
  type BatchDetailDTO,
  type Action,
  type BatchDTO,
  type ColumnFeature,
  type Role,
  type SessionUser,
} from "@/lib/domain";
import { api, errMsg, fmtDateTime, fmtDateTimeSec, fmtDuration, fmtInt, fmtShort, packLabel } from "@/lib/client";
import { Button, cn, ErrorNote, inputCls, Modal, ProductTag, SectionTitle, StatusPill, useToast } from "@/components/ui";

export type DrawerAction = "edit" | "marcar_pronto" | "liberar" | "reter" | "devolver" | "finalizar";

interface FooterAction {
  action: DrawerAction;
  label: string;
  variant: "primary" | "ok" | "outline" | "outline-danger" | "ghost";
  disabled?: boolean;
}

function actionsFor(b: BatchDTO, role: Role, features: ColumnFeature[] = [], permissions: readonly Action[] = []): FooterAction[] {
  const on = (feature: ColumnFeature) => features.length === 0 || features.includes(feature);
  if (b.status === "em_preparo" && can(role, "editar", permissions) && on("editar")) {
    return [
      { action: "edit", label: "Editar dados", variant: "outline" },
      { action: "marcar_pronto", label: "Marcar como Pronto", variant: "primary", disabled: missingForReady(b).length > 0 },
    ];
  }
  if (b.status === "pronto" && can(role, "liberar", permissions)) {
    return [
      { action: "devolver", label: "Devolver", variant: "ghost" },
      { action: "reter", label: "Reter", variant: "outline-danger" },
      { action: "liberar", label: "Liberar lote", variant: "ok" },
    ];
  }
  if (b.status === "retido" && can(role, "liberar", permissions)) {
    return [
      { action: "devolver", label: "Devolver à Produção", variant: "ghost" },
      { action: "liberar", label: "Liberar lote", variant: "ok" },
    ];
  }
  if (b.status === "liberado" && can(role, "finalizar", permissions) && on("finalizar")) {
    return [{ action: "finalizar", label: "Definir caixas e finalizar", variant: "primary" }];
  }
  return [];
}

function Datum({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className={cn("mt-0.5 text-[15px] font-semibold", mono && "font-mono")}>
        {children ?? <span className="font-normal text-ink-3">—</span>}
      </dd>
    </div>
  );
}

const EVENT_DOT: Record<string, string> = {
  liberado: "bg-ok",
  retido: "bg-stop",
  devolvido: "bg-prod",
  finalizado: "bg-acab",
  pronto: "bg-qual",
};

export function BatchDrawer({
  batchId,
  stamp,
  user,
  features = [],
  permissions = [],
  canDelete = true,
  onClose,
  onAction,
  onChanged,
}: {
  batchId: number;
  /** Muda quando o painel percebe alteração no card; dispara nova leitura. */
  stamp: string | undefined;
  user: SessionUser;
  features?: ColumnFeature[];
  permissions?: readonly Action[];
  canDelete?: boolean;
  onClose: () => void;
  onAction: (action: DrawerAction, batch: BatchDTO) => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<BatchDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api<BatchDetailDTO>(`/api/batches/${batchId}`));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, [batchId]);

  useEffect(() => {
    void load();
  }, [load, stamp]);

  async function removeAttachment(id: number, name: string) {
    try {
      await api(`/api/batches/${batchId}/attachments?attachmentId=${id}`, { method: "DELETE" });
      toast(`Anexo "${name}" removido.`);
      await load();
      onChanged();
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  async function deleteThisBatch() {
    if (!detail) return;
    setDeleting(true);
    try {
      await api(`/api/batches/${batchId}`, { method: "DELETE" });
      toast(`Batelada #${detail.number} excluída do painel.`);
      setConfirmDelete(false);
      onChanged();
      onClose();
    } catch (e) {
      toast(errMsg(e), "error");
      setDeleting(false);
    }
  }

  const actions = detail ? actionsFor(detail, user.role, features, permissions) : [];
  const myLastEvent = detail?.events.find((e) => e.userId === user.id);
  const stage = detail ? STAGE_OF[detail.status] : null;
  const missing = detail && detail.status === "em_preparo" ? missingForReady(detail) : [];
  const usedUnits = detail ? detail.outputs.reduce((acc, o) => acc + o.boxes * o.unitsPerBox, 0) : 0;
  const good = detail?.goodUnits ?? 0;
  const loss = detail?.lossUnits ?? 0;

  return (
    <>
    <Modal
      variant="drawer"
      eyebrow={stage ? `Etapa · ${STAGE_META[stage].title}` : "Batelada"}
      title={detail ? `Batelada #${detail.number}` : "Carregando…"}
      onClose={onClose}
      footer={
        detail &&
        (actions.length > 0 || (user.role === "admin" && canDelete) ? (
          <>
            {user.role === "admin" && canDelete && (
              <Button
                variant="outline-danger"
                className="mr-auto"
                icon={<Trash2 aria-hidden className="size-4" />}
                onClick={() => setConfirmDelete(true)}
              >
                Excluir batelada
              </Button>
            )}
            {actions.map((a) => (
              <Button
                key={a.action}
                variant={a.variant}
                disabled={a.disabled}
                className={cn(a.action === "devolver" && "mr-auto")}
                onClick={() => onAction(a.action, detail)}
              >
                {a.label}
              </Button>
            ))}
          </>
        ) : (
          <p className="mr-auto flex items-center gap-2 text-[13px] text-ink-2">
            <Lock aria-hidden className="size-4 shrink-0" />
            {detail.status === "em_estoque"
              ? "Batelada finalizada. As caixas estão no saldo do estoque."
              : `Somente leitura para o seu perfil. Próxima ação: ${ROLE_LABEL[STAGE_META[STAGE_OF[detail.status]].role]}.`}
          </p>
        ))
      }
    >
      {error && !detail && <ErrorNote>{error}</ErrorNote>}
      {!detail && !error && (
        <div aria-hidden className="space-y-3">
          {[72, 120, 160].map((h) => (
            <div key={h} className="animate-pulse rounded-lg bg-ink/8" style={{ height: h }} />
          ))}
        </div>
      )}

      {detail && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ProductTag brand={detail.brand} format={detail.format} size="md" />
            <StatusPill status={detail.status} />
            <span className="text-xs text-ink-3">
              Aberta por {detail.createdByName} em {fmtDateTime(detail.createdAt)}
            </span>
          </div>

          {detail.lastChangedByName && (
            <section aria-label="Última alteração" className="rounded-lg border border-line bg-card px-3 py-2.5">
              <p className="flex items-start gap-2 text-[13px]">
                <UserRound aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span className="min-w-0">
                  <span className="font-bold">Última alteração:</span> {detail.lastChangedByName}
                  {detail.lastChangedByRole && <span className="text-ink-2"> · {roleLabel(detail.lastChangedByRole)}</span>}
                  {detail.lastChangedAt && <span className="tnum text-ink-3"> · {fmtDateTimeSec(detail.lastChangedAt)}</span>}
                </span>
              </p>
              {myLastEvent && (
                <p className="mt-1.5 border-t border-line pt-1.5 text-xs text-ink-2">
                  <span className="font-semibold">Seu último registro nesta batelada ({user.profileName ?? ROLE_LABEL[user.role]}):</span>{" "}
                  {myLastEvent.message} <span className="tnum text-ink-3">· {fmtDateTimeSec(myLastEvent.createdAt)}</span>
                </p>
              )}
            </section>
          )}

          {detail.qualityNote && detail.status === "retido" && (
            <div className="flex gap-2.5 rounded-lg border border-stop/30 bg-stop-soft p-3 text-sm text-stop">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-bold">Lote retido pela Qualidade{detail.heldAt ? ` em ${fmtDateTime(detail.heldAt)}` : ""}</p>
                <p className="mt-0.5">{detail.qualityNote}</p>
              </div>
            </div>
          )}
          {detail.qualityNote && detail.status === "em_preparo" && (
            <div className="flex gap-2.5 rounded-lg border border-prod/30 bg-prod-soft p-3 text-sm text-prod">
              <Undo2 aria-hidden className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-bold">Devolvida pela Qualidade para correção</p>
                <p className="mt-0.5">{detail.qualityNote}</p>
              </div>
            </div>
          )}

          {detail.releasedAt && (
            <section aria-label="Carimbo de liberação" className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-ok/30 bg-ok-soft/60 p-4">
              <div className="stamp animate-stamp text-ok">
                <span className="text-[10px] font-bold">Qualidade · Liberado</span>
                <span className="tnum text-[17px] font-bold leading-none">{fmtDateTimeSec(detail.releasedAt)}</span>
                <span className="text-[10px]">{detail.releasedByName}</span>
              </div>
              <p className="flex min-w-44 flex-1 items-start gap-1.5 text-xs text-ink-2">
                <Lock aria-hidden className="mt-px size-3.5 shrink-0" />
                Carimbo gravado pelo servidor no instante da liberação. Fica travado no banco e não pode ser alterado.
              </p>
            </section>
          )}

          <section>
            <SectionTitle>Dados de produção</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line bg-card p-3 sm:grid-cols-3">
              <Datum label="Lote do alho" mono>
                {detail.garlicLot}
              </Datum>
              <Datum label="Lote do conservante" mono>
                {detail.preservativeLot}
              </Datum>
              <Datum label="Unidades boas">{detail.goodUnits !== null ? fmtInt(detail.goodUnits) : null}</Datum>
              <Datum label="Perdas">{detail.lossUnits !== null ? fmtInt(detail.lossUnits) : null}</Datum>
              <Datum label="Rendimento">
                {detail.goodUnits !== null && good + loss > 0 ? `${((good / (good + loss)) * 100).toFixed(1).replace(".", ",")}%` : null}
              </Datum>
            </dl>
            {missing.length > 0 && (
              <p className="mt-2 text-xs text-prod">
                <span className="font-bold">Falta para marcar Pronto:</span> {missing.join(", ").toLowerCase()}.
              </p>
            )}
          </section>

          <section>
            <SectionTitle>Horários de processo</SectionTitle>
            <div className="overflow-hidden rounded-lg border border-line bg-card">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-paper-deep/60 text-[11px] uppercase tracking-wide text-ink-3">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-bold">
                      Etapa
                    </th>
                    <th scope="col" className="px-2 py-2 font-bold">
                      Início
                    </th>
                    <th scope="col" className="px-2 py-2 font-bold">
                      Fim
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-bold">
                      Duração
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {PROCESS_STEPS.map((step) => {
                    const start = detail[step.start];
                    const end = detail[step.end];
                    return (
                      <tr key={step.key}>
                        <th scope="row" className="px-3 py-2.5 font-semibold">
                          {step.label}
                        </th>
                        <td className="tnum px-2 py-2.5">{start ? fmtShort(start) : <span className="text-ink-3">—</span>}</td>
                        <td className="tnum px-2 py-2.5">{end ? fmtShort(end) : <span className="text-ink-3">—</span>}</td>
                        <td className="tnum px-3 py-2.5 text-right text-ink-2">{start && end ? fmtDuration(start, end) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {detail.outputs.length > 0 && (
            <section>
              <SectionTitle
                aside={
                  detail.finishedAt && (
                    <span className="text-xs text-ink-3">
                      {detail.finishedByName} · {fmtShort(detail.finishedAt)}
                    </span>
                  )
                }
              >
                Caixas geradas no acabamento
              </SectionTitle>
              <ul className="divide-y divide-line rounded-lg border border-line bg-card">
                {detail.outputs.map((o) => (
                  <li key={o.packagingOptionId} className="flex items-baseline justify-between gap-3 px-3 py-2.5 text-sm">
                    <span className="font-semibold">{packLabel(o.label, o.unitsPerBox)}</span>
                    <span className="tnum">
                      <span className="text-[15px] font-bold">{fmtInt(o.boxes)}</span> cx
                      <span className="ml-2 text-xs text-ink-3">{fmtInt(o.boxes * o.unitsPerBox)} un</span>
                    </span>
                  </li>
                ))}
                <li className="tnum flex items-baseline justify-between gap-3 bg-paper-deep/50 px-3 py-2 text-xs text-ink-2">
                  <span>
                    {fmtInt(usedUnits)} de {fmtInt(good)} unidades encaixotadas
                  </span>
                  <span>sobra: {fmtInt(Math.max(0, good - usedUnits))} un</span>
                </li>
              </ul>
            </section>
          )}

          {detail.notes && (
            <section>
              <SectionTitle>Observações</SectionTitle>
              <p className="whitespace-pre-wrap rounded-lg border border-line bg-card p-3 text-sm text-ink-2">{detail.notes}</p>
            </section>
          )}

          <section>
            <SectionTitle
              aside={
                <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-hivis">Simulado</span>
              }
            >
              Pasta no Google Drive
            </SectionTitle>
            <div className="rounded-lg border border-line bg-card">
              <div className="flex items-start gap-2.5 p-3">
                <FolderOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-prod" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold [overflow-wrap:anywhere]">{detail.driveFolderPath ?? "Pasta não criada"}</p>
                  {detail.driveFolderId && <p className="mt-0.5 break-all font-mono text-[11px] text-ink-3">ID {detail.driveFolderId}</p>}
                </div>
              </div>

              {detail.attachments.length > 0 ? (
                <ul className="divide-y divide-line border-t border-line">
                  {detail.attachments.map((a) => (
                    <li key={a.id} className="flex items-center gap-2.5 px-3 py-2">
                      {a.kind === "laudo" ? (
                        <FileText aria-hidden className="size-4 shrink-0 text-qual" />
                      ) : (
                        <ImageIcon aria-hidden className="size-4 shrink-0 text-acab" />
                      )}
                      <div className="min-w-0 flex-1">
                        <a
                          href={a.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-1 rounded text-sm font-semibold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                        >
                          <span className="truncate">{a.name}</span>
                          <ExternalLink aria-hidden className="size-3 shrink-0" />
                          <span className="sr-only">(abre em nova aba)</span>
                        </a>
                        <p className="text-[11px] text-ink-3">
                          {a.kind === "laudo" ? "Laudo" : "Foto"} · {a.createdByName} · {fmtShort(a.createdAt)}
                        </p>
                      </div>
                      {(user.role === "admin" || a.createdById === user.id) && (
                        <button
                          type="button"
                          onClick={() => void removeAttachment(a.id, a.name)}
                          aria-label={`Remover anexo ${a.name}`}
                          className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-3 transition hover:bg-stop-soft hover:text-stop"
                        >
                          <Trash2 aria-hidden className="size-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t border-line px-3 py-3 text-[13px] text-ink-3">Nenhum laudo ou foto anexado ainda.</p>
              )}

              {canAttach(user.role, detail.status, permissions) && (features.length === 0 || features.includes("anexar")) && (
                <AttachForm
                  batchId={detail.id}
                  onAdded={async () => {
                    await load();
                    onChanged();
                  }}
                />
              )}
            </div>
          </section>

          <section>
            <SectionTitle>Histórico</SectionTitle>
            <ol className="relative space-y-3 pl-5 before:absolute before:inset-y-1.5 before:left-[5px] before:w-px before:bg-line">
              {detail.events.map((e) => (
                <li key={e.id} className="relative">
                  <span
                    aria-hidden
                    className={cn("absolute -left-5 top-1.5 size-[11px] rounded-full border-2 border-paper", EVENT_DOT[e.type] ?? "bg-ink-3")}
                  />
                  <p className="text-[13px] text-ink [overflow-wrap:anywhere]">{e.message}</p>
                  <p className="tnum text-[11px] text-ink-3">
                    {fmtDateTimeSec(e.createdAt)} · {e.userName}
                    {e.userRole && ` (${roleLabel(e.userRole)})`}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}

    </Modal>
    {confirmDelete && detail && (
        <Modal
          eyebrow="Admin · confirmação"
          title={`Excluir batelada #${detail.number}?`}
          onClose={() => setConfirmDelete(false)}
          width="max-w-lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancelar
              </Button>
              <Button variant="danger" loading={deleting} onClick={() => void deleteThisBatch()}>
                Excluir do painel
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="flex gap-2 rounded-lg bg-stop-soft px-3 py-2.5 text-sm text-stop">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>O card sai do painel de produção permanentemente.</span>
            </p>
            <p className="text-sm leading-relaxed text-ink-2">
              Por rastreabilidade, a exclusão é lógica: caixas já produzidas, expedições, anexos e o histórico permanecem no
              estoque e nos relatórios (com a marcação de excluída). O carimbo de liberação, se houver, continua imutável.
            </p>
          </div>
        </Modal>
      )}
    </>
  );
}

function AttachForm({ batchId, onAdded }: { batchId: number; onAdded: () => Promise<void> }) {
  const toast = useToast();
  const [kind, setKind] = useState<AttachmentKind>("laudo");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/batches/${batchId}/attachments`, { method: "POST", body: { kind, name, url } });
      toast(`${kind === "laudo" ? "Laudo" : "Foto"} anexado(a) à pasta da batelada.`);
      setName("");
      setUrl("");
      await onAdded();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2.5 border-t border-line bg-paper-deep/40 p-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-bold text-ink-2">Anexar link</span>
        <div className="flex overflow-hidden rounded-lg border border-ink/25" role="group" aria-label="Tipo de anexo">
          {(["laudo", "foto"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cn("h-9 px-3 text-xs font-bold transition", kind === k ? "bg-ink text-paper" : "bg-white text-ink hover:bg-paper")}
            >
              {k === "laudo" ? "Laudo" : "Foto"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1.3fr]">
        <input
          className={inputCls}
          aria-label="Nome do anexo"
          placeholder={kind === "laudo" ? "Laudo microbiológico" : "Foto do envase"}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          className={inputCls}
          aria-label="Link do arquivo"
          type="url"
          inputMode="url"
          placeholder="https://drive.google.com/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" size="sm" variant="outline" loading={busy} disabled={name.trim().length < 2 || url.trim().length < 8}>
        Guardar na pasta
      </Button>
    </form>
  );
}
