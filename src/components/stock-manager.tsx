/* eslint-disable react/jsx-key -- as células são renderizadas com key pelo componente Table */
"use client";

import { usePageLoading } from "@/components/splash-provider";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Boxes, CheckCircle2, Lock, PackagePlus, Pencil, Plus, RefreshCw, Search, Trash2, Truck } from "lucide-react";
import type { AdjustmentDTO, InventoryRowDTO, ShipmentDTO, StockManageDTO } from "@/lib/domain";
import { api, errMsg, fmtDateTime, fmtInt, packLabel } from "@/lib/client";
import { DeleteInventoryDialog, InventoryItemDialog } from "@/components/inventory-item-dialog";
import { useAuth } from "@/components/auth-provider";
import { can } from "@/lib/domain";
import { Button, cn, ErrorNote, Field, inputCls, Modal, SectionTitle, useToast } from "@/components/ui";

type Dialog =
  | { kind: "item-create" }
  | { kind: "item-edit"; item: InventoryRowDTO }
  | { kind: "item-delete"; item: InventoryRowDTO }
  | { kind: "adjust"; optionId?: number }
  | { kind: "adjust-edit"; item: AdjustmentDTO }
  | { kind: "adjust-delete"; item: AdjustmentDTO }
  | { kind: "shipment-edit"; item: ShipmentDTO }
  | { kind: "shipment-delete"; item: ShipmentDTO }
  | null;

function Table({ headers, rows, empty }: { headers: string[]; rows: Array<Array<ReactNode>>; empty: string }) {
  if (rows.length === 0) return <p className="rounded-lg border border-dashed border-ink/25 px-3 py-6 text-center text-sm text-ink-3">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead className="bg-paper-deep/60 text-[11px] uppercase tracking-wide text-ink-3">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2.5 font-bold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-paper-deep/30">
              {row.map((cell, j) => (
                <td key={j} className={cn("px-3 py-2.5", j > 0 && "tnum")}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StockManager() {
  const toast = useToast();
  const user = useAuth();
  const manage = can(user.role, "separar", user.permissions);
  const admin = user.role === "admin";
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [data, setData] = useState<StockManageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageLoading(data === null && error === null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!quiet) setLoading(true);
    try {
      setData(await api<StockManageDTO>("/api/stock"));
      setUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = window.setInterval(refresh, 8000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  function openDialog(next: Dialog) {
    setDialogError(null);
    setDialog(next);
  }

  async function submit(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setDialogError(null);
    try {
      await fn();
      toast(ok);
      setDialog(null);
      await load();
    } catch (e) {
      setDialogError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const total = data?.rows.reduce((acc, r) => acc + r.balance, 0) ?? 0;
  const options = (data?.rows ?? []).map((r) => ({
    id: r.packagingOptionId,
    label: `${r.brand} ${r.format} · ${packLabel(r.label, r.unitsPerBox)}`,
    balance: r.balance,
  }));
  const query = search.trim().toLocaleLowerCase("pt-BR");
  const visibleRows = (data?.rows ?? []).filter((r) =>
    !query || `${r.name ?? ""} ${r.brand} ${r.format} ${r.label} ${r.unitsPerBox} ${r.location ?? ""}`.toLocaleLowerCase("pt-BR").includes(query),
  );
  const movementLabel: Record<AdjustmentDTO["kind"], string> = {
    manual: "Ajuste manual", opening: "Cadastro do item", balance_edit: "Edição de item", item_delete: "Exclusão de item",
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-3 pb-14 pt-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Estoque e Logística</p>
            <h1 className="display mt-1.5 text-[34px]">Gestão de estoque</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
              Entradas da produção, saldos e separações em um só lugar.
              {admin ? " Crie, edite ou exclua itens diretamente abaixo." : " Consulte os itens e acompanhe as movimentações do estoque."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" loading={loading} icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => void load()}>
              Atualizar
            </Button>
            {manage && <Button variant="outline" icon={<Plus aria-hidden className="size-4" />} onClick={() => openDialog({ kind: "adjust" })} disabled={!data?.rows.length}>
              Novo ajuste
            </Button>}
            {admin && <Button variant="hivis" icon={<PackagePlus aria-hidden className="size-4" />} onClick={() => openDialog({ kind: "item-create" })} disabled={!data}>
              Novo item
            </Button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-acab/20 bg-acab-soft/50 px-3 py-2.5 text-xs text-acab">
          <CheckCircle2 aria-hidden className="size-4 shrink-0" />
          <span><strong>Entrada automática.</strong> Ao finalizar uma batelada, as caixas entram no item correspondente. Se ele não existir, será criado.</span>
          <span className="ml-auto whitespace-nowrap text-ink-3">Atualiza a cada 8 s</span>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-ink bg-ink px-4 py-3 text-paper">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-paper/65">Saldo total</p>
            <p className="display tnum mt-1 text-[36px]">
              {fmtInt(total)} <span className="text-[15px] tracking-wide text-hivis">caixas</span>
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">Itens no estoque</p>
            <p className="display tnum mt-1 text-[36px]">{data?.rows.length ?? "–"}</p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">Movimentos de saldo</p>
            <p className="display tnum mt-1 text-[36px]">{data?.adjustments.length ?? "–"}</p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">Expedições</p>
            <p className="display tnum mt-1 text-[36px]">{data?.shipments.length ?? "–"}</p>
          </div>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}

        {!data && !error && <div aria-hidden className="h-52 animate-pulse rounded-xl bg-ink/8" />}

        {data && (
          <>
            <section aria-label="Itens de estoque">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="display text-[22px]">Saldo por embalagem</h2>
                  <p className="mt-1 text-xs text-ink-3">{visibleRows.length} de {data.rows.length} item(ns) · saldos zero também são exibidos</p>
                </div>
                <label className="relative block w-full sm:max-w-xs">
                  <Search aria-hidden className="pointer-events-none absolute left-3 top-3 size-4 text-ink-3" />
                  <span className="sr-only">Buscar item de estoque</span>
                  <input className={cn(inputCls, "pl-9")} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Produto, embalagem ou localização" />
                </label>
              </div>
              <div className="overflow-x-auto rounded-xl border border-line bg-card">
                <table className="w-full min-w-[870px] text-left text-[13px]">
                  <thead className="bg-paper-deep/60 text-[11px] uppercase tracking-wide text-ink-3">
                    <tr>{["Item / embalagem", "Localização", "Produção", "Ajustes", "Expedidas", "Saldo atual", "Ações"].map((h) => <th key={h} scope="col" className="whitespace-nowrap px-3 py-3 font-bold">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {visibleRows.map((r) => (
                      <tr key={r.id} className="transition hover:bg-paper-deep/25">
                        <td className="px-3 py-3.5">
                          <p className="font-semibold">{r.name || `${r.brand} ${r.format}`}</p>
                          <p className="mt-0.5 text-xs text-ink-2">{r.name ? `${r.brand} ${r.format} · ` : ""}{packLabel(r.label, r.unitsPerBox)}</p>
                          <p className="mt-1 flex items-center gap-1 text-[10px] text-ink-3">{r.source === "production" ? <><CheckCircle2 aria-hidden className="size-3 text-acab" /> Entrada da produção</> : r.source === "manual" ? "Cadastro manual" : "Estoque já registrado"}</p>
                        </td>
                        <td className="max-w-40 px-3 py-3.5 text-xs text-ink-2">{r.location || "—"}</td>
                        <td className="tnum px-3 py-3.5">{fmtInt(r.produced)}</td>
                        <td className={cn("tnum px-3 py-3.5", r.adjusted < 0 ? "text-stop" : "text-ink-2")}>{r.adjusted > 0 ? "+" : ""}{fmtInt(r.adjusted)}</td>
                        <td className="tnum px-3 py-3.5">{fmtInt(r.shipped)}</td>
                        <td className="px-3 py-3.5"><strong className="tnum text-[19px]">{fmtInt(r.balance)}</strong><span className="ml-1 text-xs text-ink-3">cx</span><p className="tnum text-[11px] text-ink-3">{fmtInt(r.balance * r.unitsPerBox)} un</p></td>
                        <td className="px-3 py-3.5">
                          {admin ? <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="outline" aria-label={`Editar item ${r.brand} ${r.format} ${packLabel(r.label, r.unitsPerBox)}`} onClick={() => openDialog({ kind: "item-edit", item: r })} icon={<Pencil aria-hidden className="size-3.5" />}>Editar</Button>
                            <Button size="sm" variant="ghost" className="text-stop hover:bg-stop-soft hover:text-stop" aria-label={`Excluir item ${r.brand} ${r.format} ${packLabel(r.label, r.unitsPerBox)}`} onClick={() => openDialog({ kind: "item-delete", item: r })} icon={<Trash2 aria-hidden className="size-3.5" />}>Excluir</Button>
                          </div> : manage ? <Button size="sm" variant="outline" onClick={() => openDialog({ kind: "adjust", optionId: r.packagingOptionId })}>Ajustar</Button> : <span className="text-xs text-ink-3">Consulta</span>}
                        </td>
                      </tr>
                    ))}
                    {!visibleRows.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-3">{search ? "Nenhum item corresponde à busca." : "Nenhum item cadastrado. Crie um item ou finalize uma batelada para começar."}</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-ink-3">Saldo = produção + ajustes − expedições. Alterações manuais preservam o histórico das bateladas.</p>
            </section>

            <section>
              <SectionTitle aside={<span className="text-xs text-ink-3">Últimas 100 entradas · sem lançamento manual</span>}>Entradas da produção</SectionTitle>
              <Table
                headers={["Batelada", "Produto", "Embalagem", "Caixas recebidas", "Finalizada por", "Quando"]}
                rows={data.receipts.map((r) => [
                  <span key="batch" className="font-mono font-semibold">#{r.batchNumber}</span>, `${r.brand} ${r.format}`, packLabel(r.label, r.unitsPerBox),
                  <span key="boxes" className="font-bold text-acab">+{fmtInt(r.boxes)}</span>, r.finishedByName ?? "—", fmtDateTime(r.finishedAt),
                ])}
                empty="As caixas aparecerão aqui assim que uma batelada for finalizada e enviada ao estoque."
              />
            </section>

            <section>
              <SectionTitle aside={<span className="text-xs text-ink-3">Últimos 200 registros</span>}>Histórico de saldo</SectionTitle>
              <Table
                headers={["Quando", "Item", "Caixas", "Motivo", "Por", "Ações"]}
                rows={data.adjustments.map((a) => [
                  fmtDateTime(a.createdAt),
                  `${a.brand} ${a.format} · ${packLabel(a.label, a.unitsPerBox)}`,
                  <span className={cn("font-bold", a.boxes < 0 ? "text-stop" : "text-ok")}>{a.boxes > 0 ? `+${fmtInt(a.boxes)}` : fmtInt(a.boxes)}</span>,
                  <div><span className="text-[10px] font-bold uppercase tracking-wide text-ink-3">{movementLabel[a.kind]}</span><p className="mt-0.5 text-xs">{a.reason}</p></div>,
                  a.createdByName,
                  <span className="flex gap-1">
                    {manage && a.canModify && <IconBtn label={`Editar ajuste ${a.id}`} onClick={() => openDialog({ kind: "adjust-edit", item: a })} icon={<Pencil />} />}
                    {manage && a.canModify && <IconBtn label={`Excluir ajuste ${a.id}`} onClick={() => openDialog({ kind: "adjust-delete", item: a })} icon={<Trash2 />} danger />}
                    {!a.canModify && <span title="Registro preservado para auditoria" className="flex items-center gap-1 text-[11px] text-ink-3"><Lock aria-hidden className="size-3" /> Registro</span>}
                  </span>,
                ])}
                empty="Nenhum ajuste lançado."
              />
            </section>

            <section>
              <SectionTitle>Expedições (separações de pedido)</SectionTitle>
              <Table
                headers={["Pedido", "Cliente", "Item", "Caixas", "Por", "Quando", "Ações"]}
                rows={data.shipments.map((s) => [
                  <span className="font-mono font-semibold">{s.orderRef}</span>,
                  s.customer ?? "—",
                  `${s.brand} ${s.format} · ${s.label}`,
                  fmtInt(s.boxes),
                  s.createdByName,
                  fmtDateTime(s.createdAt),
                  <span className="flex gap-1">
                    {manage && <IconBtn label={`Editar expedição ${s.id}`} onClick={() => openDialog({ kind: "shipment-edit", item: s })} icon={<Pencil />} />}
                    {manage && <IconBtn label={`Excluir expedição ${s.id}`} onClick={() => openDialog({ kind: "shipment-delete", item: s })} icon={<Trash2 />} danger />}
                  </span>,
                ])}
                empty="Nenhuma expedição registrada."
              />
            </section>
          </>
        )}

        {updatedAt && <p className="text-[11px] text-ink-3">Última atualização: {fmtDateTime(updatedAt)} · dados salvos no banco.</p>}

        {admin && data && (dialog?.kind === "item-create" || dialog?.kind === "item-edit") && (
          <InventoryItemDialog
            key={dialog.kind === "item-edit" ? dialog.item.id : "new"}
            item={dialog.kind === "item-edit" ? dialog.item : undefined}
            data={data} busy={busy} error={dialogError}
            onClose={() => setDialog(null)}
            onSave={(body) => void submit(
              () => api("/api/stock/items", { method: dialog.kind === "item-edit" ? "PATCH" : "POST", body }),
              dialog.kind === "item-edit" ? "Item e saldo atualizados." : "Item criado no estoque.",
            )}
          />
        )}
        {admin && dialog?.kind === "item-delete" && (
          <DeleteInventoryDialog item={dialog.item} busy={busy} error={dialogError} onClose={() => setDialog(null)}
            onConfirm={() => void submit(() => api("/api/stock/items", {
              method: "DELETE", body: { id: dialog.item.id, revision: dialog.item.revision },
            }), "Item excluído do estoque. Histórico preservado.")}
          />
        )}

        {(dialog?.kind === "adjust" || dialog?.kind === "adjust-edit") && (
          <AdjustmentDialog
            item={dialog.kind === "adjust-edit" ? dialog.item : undefined}
            options={options}
            initialOptionId={dialog.kind === "adjust" ? dialog.optionId : undefined}
            busy={busy}
            error={dialogError}
            onClose={() => setDialog(null)}
            onSubmit={(body) =>
              void submit(
                () =>
                  api("/api/stock/adjustments", {
                    method: dialog.kind === "adjust-edit" ? "PATCH" : "POST",
                    body,
                  }),
                dialog.kind === "adjust-edit" ? "Ajuste atualizado." : "Ajuste lançado no estoque.",
              )
            }
          />
        )}
        {dialog?.kind === "shipment-edit" && (
          <ShipmentDialog
            item={dialog.item}
            options={options}
            busy={busy}
            error={dialogError}
            onClose={() => setDialog(null)}
            onSubmit={(body) =>
              void submit(() => api(`/api/shipments/${dialog.item.id}`, { method: "PATCH", body }), "Expedição atualizada.")
            }
          />
        )}
        {(dialog?.kind === "adjust-delete" || dialog?.kind === "shipment-delete") && (
          <Modal
            eyebrow="Estoque · confirmação"
            title="Excluir este lançamento?"
            onClose={() => setDialog(null)}
            width="max-w-lg"
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button>
                <Button
                  variant="danger"
                  loading={busy}
                  onClick={() => {
                    const isAdjust = dialog.kind === "adjust-delete";
                    void submit(
                      () =>
                        isAdjust
                          ? api(`/api/stock/adjustments?id=${dialog.kind === "adjust-delete" ? dialog.item.id : ""}`, { method: "DELETE" })
                          : api(`/api/shipments/${dialog.kind === "shipment-delete" ? dialog.item.id : ""}`, { method: "DELETE" }),
                      isAdjust ? "Ajuste excluído." : "Expedição excluída: as caixas voltaram ao saldo.",
                    );
                  }}
                >
                  Excluir
                </Button>
              </>
            }
          >
            <p className="text-sm text-ink-2">
              {dialog.kind === "adjust-delete"
                ? `Ajuste de ${fmtInt(dialog.item.boxes)} caixas (${dialog.item.reason}). O saldo será recalculado e o registro fica no banco para auditoria.`
                : `Pedido ${dialog.item.orderRef}, ${fmtInt(dialog.item.boxes)} caixas. As caixas voltam a ficar disponíveis no saldo.`}
            </p>
            <ErrorNote>{dialogError}</ErrorNote>
          </Modal>
        )}
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, icon, danger }: { label: string; onClick: () => void; icon: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("grid size-9 place-items-center rounded-lg text-ink-3 transition [&>svg]:size-4", danger ? "hover:bg-stop-soft hover:text-stop" : "hover:bg-ink/8 hover:text-ink")}
    >
      {icon}
    </button>
  );
}

function AdjustmentDialog({
  item,
  options,
  initialOptionId,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  item?: AdjustmentDTO;
  options: Array<{ id: number; label: string; balance: number }>;
  initialOptionId?: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [optionId, setOptionId] = useState(item?.packagingOptionId ?? initialOptionId ?? options[0]?.id ?? 0);
  const [kind, setKind] = useState<"in" | "out">(item && item.boxes < 0 ? "out" : "in");
  const [amount, setAmount] = useState(item ? String(Math.abs(item.boxes)) : "");
  const [reason, setReason] = useState(item?.reason ?? "");
  const selected = options.find((o) => o.id === optionId);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!n) return;
    onSubmit({
      ...(item ? { id: item.id } : { packagingOptionId: optionId }),
      boxes: kind === "in" ? n : -n,
      reason,
    });
  }

  return (
    <Modal
      eyebrow="Estoque · lançamento"
      title={item ? "Editar ajuste" : "Novo ajuste de estoque"}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" form="adjust-form" loading={busy} disabled={!amount || Number(amount) < 1 || reason.trim().length < 3}>Salvar</Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={submit} className="space-y-4">
        <Field label="Embalagem / item">
          <select className={inputCls} value={optionId} disabled={!!item} onChange={(e) => setOptionId(Number(e.target.value))}>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>
        {selected && <p className="text-xs text-ink-3">Saldo atual: <strong className="tnum text-ink">{fmtInt(selected.balance)}</strong> caixas</p>}
        <div className="flex gap-2" role="group" aria-label="Tipo de ajuste">
          {(["in", "out"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={cn("flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border-2 text-sm font-bold transition", kind === k ? (k === "in" ? "border-ok bg-ok-soft text-ok" : "border-stop bg-stop-soft text-stop") : "border-ink/20 bg-white text-ink-2")}
            >
              {k === "in" ? <Boxes aria-hidden className="size-4" /> : <Truck aria-hidden className="size-4" />}
              {k === "in" ? "Entrada (+)" : "Baixa (−)"}
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Quantidade de caixas">
            <input className={cn(inputCls, "tnum font-bold")} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </Field>
          <Field label="Motivo">
            <input className={inputCls} value={reason} maxLength={200} placeholder="Ex.: inventário, avaria, devolução" onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}

function ShipmentDialog({
  item,
  options,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  item: ShipmentDTO;
  options: Array<{ id: number; label: string; balance: number }>;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [boxes, setBoxes] = useState(String(item.boxes));
  const [orderRef, setOrderRef] = useState(item.orderRef);
  const [customer, setCustomer] = useState(item.customer ?? "");
  const [optionId, setOptionId] = useState(0);

  return (
    <Modal
      eyebrow={`Expedição ${item.orderRef}`}
      title="Editar separação"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button
            loading={busy}
            onClick={() =>
              onSubmit({ boxes: Number(boxes), orderRef, customer, ...(optionId ? { packagingOptionId: optionId } : {}) })
            }
            disabled={Number(boxes) < 1 || !orderRef.trim()}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Item (deixe como está para não trocar)" optional>
          <select className={inputCls} value={optionId} onChange={(e) => setOptionId(Number(e.target.value))}>
            <option value="">Manter: {item.brand} {item.format} · {item.label}</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Caixas">
            <input className={cn(inputCls, "tnum font-bold")} inputMode="numeric" value={boxes} onChange={(e) => setBoxes(e.target.value.replace(/\D/g, "").slice(0, 6))} />
          </Field>
          <Field label="Pedido">
            <input className={cn(inputCls, "font-mono")} value={orderRef} maxLength={40} onChange={(e) => setOrderRef(e.target.value)} />
          </Field>
          <Field label="Cliente" optional>
            <input className={inputCls} value={customer} maxLength={80} onChange={(e) => setCustomer(e.target.value)} />
          </Field>
        </div>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
