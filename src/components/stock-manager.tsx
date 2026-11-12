"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Boxes, Pencil, Plus, RefreshCw, Trash2, Truck } from "lucide-react";
import type { AdjustmentDTO, ShipmentDTO, StockManageDTO, StockRowDTO } from "@/lib/domain";
import { api, errMsg, fmtDateTime, fmtInt, packLabel } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal, SectionTitle, useToast } from "@/components/ui";

type Dialog =
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
  const [data, setData] = useState<StockManageDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<StockManageDTO>("/api/stock"));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
  const rowsWithMovement = (data?.rows ?? []).filter((r) => r.produced + r.adjusted + r.shipped > 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-3 pb-14 pt-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Estoque e Logística</p>
            <h1 className="display mt-1.5 text-[34px]">Gestão de estoque</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-ink-2">
              Saldo por embalagem = caixas produzidas + ajustes − expedições. Aqui você adiciona, edita e exclui lançamentos e separações.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => void load()}>
              Atualizar
            </Button>
            <Button variant="hivis" icon={<Plus aria-hidden className="size-4" />} onClick={() => setDialog({ kind: "adjust" })} disabled={!data}>
              Novo ajuste
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="rounded-xl border border-ink bg-ink px-4 py-3 text-paper">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-paper/65">Saldo total</p>
            <p className="display tnum mt-1 text-[36px]">
              {fmtInt(total)} <span className="text-[15px] tracking-wide text-hivis">caixas</span>
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card px-4 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">Ajustes ativos</p>
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
            <section>
              <SectionTitle aside={<span className="text-xs text-ink-3">{rowsWithMovement.length} itens com movimento</span>}>Saldo por embalagem</SectionTitle>
              <Table
                headers={["Produto", "Embalagem", "Produzidas", "Ajustes", "Expedidas", "Saldo", ""]}
                rows={rowsWithMovement.map((r) => [
                  `${r.brand} ${r.format}`,
                  packLabel(r.label, r.unitsPerBox),
                  fmtInt(r.produced),
                  <span className={r.adjusted < 0 ? "text-stop" : "text-ok"}>{r.adjusted > 0 ? `+${fmtInt(r.adjusted)}` : fmtInt(r.adjusted)}</span>,
                  fmtInt(r.shipped),
                  <span className="font-bold">{fmtInt(r.balance)}</span>,
                  <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "adjust", optionId: r.packagingOptionId })}>Ajustar</Button>,
                ])}
                empty="Nenhum movimento. Cadastre embalagens em Admin › Produtos e classificações e lance uma entrada."
              />
              <p className="mt-2 text-xs text-ink-3">
                Para criar novas embalagens, use <strong>Admin › Produtos e classificações</strong>. Um ajuste positivo adiciona caixas; negativo faz baixa.
              </p>
            </section>

            <section>
              <SectionTitle>Lançamentos de ajuste</SectionTitle>
              <Table
                headers={["Quando", "Item", "Caixas", "Motivo", "Por", "Ações"]}
                rows={data.adjustments.map((a) => [
                  fmtDateTime(a.createdAt),
                  `${a.brand} ${a.format} · ${packLabel(a.label, a.unitsPerBox)}`,
                  <span className={cn("font-bold", a.boxes < 0 ? "text-stop" : "text-ok")}>{a.boxes > 0 ? `+${fmtInt(a.boxes)}` : fmtInt(a.boxes)}</span>,
                  a.reason,
                  a.createdByName,
                  <span className="flex gap-1">
                    <IconBtn label={`Editar ajuste ${a.id}`} onClick={() => setDialog({ kind: "adjust-edit", item: a })} icon={<Pencil />} />
                    <IconBtn label={`Excluir ajuste ${a.id}`} onClick={() => setDialog({ kind: "adjust-delete", item: a })} icon={<Trash2 />} danger />
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
                    <IconBtn label={`Editar expedição ${s.id}`} onClick={() => setDialog({ kind: "shipment-edit", item: s })} icon={<Pencil />} />
                    <IconBtn label={`Excluir expedição ${s.id}`} onClick={() => setDialog({ kind: "shipment-delete", item: s })} icon={<Trash2 />} danger />
                  </span>,
                ])}
                empty="Nenhuma expedição registrada."
              />
            </section>
          </>
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
