"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, Info, PackagePlus, Trash2 } from "lucide-react";
import type { InventoryRowDTO, StockManageDTO } from "@/lib/domain";
import { fmtInt, packLabel } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal } from "@/components/ui";

export function InventoryItemDialog({
  item, data, readOnly = false, busy, error, onClose, onSave,
}: {
  item?: InventoryRowDTO;
  data: StockManageDTO;
  readOnly?: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [productId, setProductId] = useState(item ? String(item.productId) : "");
  const [optionId, setOptionId] = useState(item ? String(item.packagingOptionId) : "");
  const [label, setLabel] = useState("Caixa");
  const [units, setUnits] = useState("");
  const [balance, setBalance] = useState(String(item?.balance ?? 0));
  const [name, setName] = useState(item?.name ?? "");
  const [location, setLocation] = useState(item?.location ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [reason, setReason] = useState("");
  const product = data.products.find((p) => String(p.id) === productId);
  const newPackage = optionId === "new";
  const occupied = new Set(data.rows.map((r) => r.packagingOptionId));
  const validQuantity = /^\d+$/.test(balance) && Number(balance) <= 5_000_000;
  const valid = validQuantity && (item ? reason.trim().length >= 3 : Boolean(product && optionId) && (!newPackage || (label.trim() && Number(units) >= 1 && Number(units) <= 1000)));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (readOnly || !valid) return;
    const common = { name, location, notes, balance: Number(balance) };
    onSave(item
      ? { ...common, id: item.id, revision: item.revision, reason }
      : { ...common, productId: Number(productId), ...(newPackage ? { newPackaging: { label, unitsPerBox: Number(units) } } : { packagingOptionId: Number(optionId) }) });
  }

  return (
    <Modal
      eyebrow="Administração · estoque"
      title={item ? "Editar item de estoque" : "Novo item de estoque"}
      onClose={onClose}
      width="max-w-xl"
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" form="inventory-item-form" variant="hivis" loading={busy} disabled={readOnly || !valid} icon={<PackagePlus aria-hidden className="size-4" />}>
          {item ? "Salvar alterações" : "Criar item"}
        </Button>
      </>}
    >
      <form id="inventory-item-form" onSubmit={submit} className="space-y-4">
        {readOnly && <p className="rounded-lg bg-qual-soft px-3 py-2 text-xs font-medium text-qual">Modo visualização (somente leitura): alterações não podem ser salvas.</p>}
        {item ? (
          <div className="rounded-lg border border-line bg-card p-3">
            <p className="text-sm font-bold">{item.brand} {item.format} · {packLabel(item.label, item.unitsPerBox)}</p>
            <p className="mt-1 text-xs text-ink-3">O vínculo com produto e embalagem é preservado. Para outro produto ou tamanho de caixa, crie um novo item.</p>
          </div>
        ) : (
          <>
            <Field label="Produto">
              <select className={inputCls} value={productId} onChange={(e) => { setProductId(e.target.value); setOptionId(""); }} required>
                <option value="">Selecione um produto</option>
                {data.products.map((p) => <option key={p.id} value={p.id}>{p.brand} · {p.format}</option>)}
              </select>
            </Field>
            {!data.products.length && <p className="text-sm text-prod">Cadastre ou ative um produto em Admin → Produtos antes de criar seu estoque.</p>}
            <Field label="Embalagem" hint="Cada produto + embalagem possui um único saldo. Itens já cadastrados são editados na tabela.">
              <select className={inputCls} value={optionId} disabled={!product} onChange={(e) => setOptionId(e.target.value)} required>
                <option value="">Selecione a embalagem</option>
                {product?.packaging.map((o) => <option key={o.id} value={o.id} disabled={occupied.has(o.id)}>{packLabel(o.label, o.unitsPerBox)}{occupied.has(o.id) ? " — já no estoque" : ""}</option>)}
                <option value="new">+ Cadastrar nova embalagem</option>
              </select>
            </Field>
            {newPackage && <div className="grid gap-3 rounded-lg border border-line bg-card p-3 sm:grid-cols-2">
              <Field label="Tipo de embalagem"><input className={inputCls} value={label} maxLength={20} onChange={(e) => setLabel(e.target.value)} placeholder="Caixa, pack…" /></Field>
              <Field label="Unidades por embalagem"><input className={inputCls} inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="12" /></Field>
            </div>}
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome no estoque" optional><input className={inputCls} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Usar nome do produto" /></Field>
          <Field label="Localização" optional><input className={inputCls} value={location} maxLength={80} onChange={(e) => setLocation(e.target.value)} placeholder="Ex.: corredor A · prateleira 2" /></Field>
        </div>
        <div className="rounded-lg border border-line bg-card p-3">
          <Field label={item ? "Saldo desejado (caixas)" : "Saldo inicial (caixas)"} hint={item ? "Digite o saldo total correto, não a diferença." : "Pode iniciar em zero. Novas bateladas somam caixas automaticamente."}>
            <input className={cn(inputCls, "tnum font-bold")} inputMode="numeric" pattern="[0-9]*" value={balance} onChange={(e) => setBalance(e.target.value.replace(/\D/g, "").slice(0, 7))} required />
          </Field>
          {item && validQuantity && <p className="mt-2 flex items-center gap-2 text-sm text-ink-2" aria-live="polite">
            <span className="tnum">{fmtInt(item.balance)} cx</span><ArrowRight aria-hidden className="size-3.5" /><strong className="tnum">{fmtInt(Number(balance))} cx</strong>
            <span className="tnum ml-auto text-xs">{Number(balance) - item.balance > 0 ? "+" : ""}{fmtInt(Number(balance) - item.balance)} cx no histórico</span>
          </p>}
        </div>
        {item && <Field label="Motivo da alteração"><input className={inputCls} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: conferência física do estoque" required /></Field>}
        <Field label="Observações" optional><textarea className={cn(inputCls, "h-20 resize-none py-2.5")} value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-3"><Info aria-hidden className="mt-px size-3.5 shrink-0" />As caixas de bateladas finalizadas continuam sendo somadas. Alterar o saldo não modifica a quantidade registrada nas bateladas anteriores.</p>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}

export function DeleteInventoryDialog({ item, readOnly = false, busy, error, onClose, onConfirm }: {
  item: InventoryRowDTO;
  readOnly?: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return <Modal eyebrow="Administração · estoque" title="Excluir este item?" onClose={onClose} width="max-w-lg" footer={<>
    <Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
    <Button variant="danger" loading={busy} disabled={readOnly} onClick={onConfirm} icon={<Trash2 aria-hidden className="size-4" />}>Excluir item</Button>
  </>}>
    <div className="space-y-3">
      <p className="rounded-lg border border-line bg-card p-3 text-sm font-semibold">{item.name || `${item.brand} ${item.format}`} · {packLabel(item.label, item.unitsPerBox)}</p>
      <p className="text-sm leading-relaxed text-ink-2">O item sairá da lista e seu saldo de <strong>{fmtInt(item.balance)} caixa(s)</strong> será zerado com uma baixa identificada. As bateladas, expedições e o histórico não serão apagados.</p>
      <p className="rounded-lg bg-prod-soft p-3 text-xs leading-relaxed text-prod">Se uma nova batelada desta embalagem for finalizada depois, o item volta automaticamente ao estoque apenas com as novas caixas.</p>
      <ErrorNote>{error}</ErrorNote>
    </div>
  </Modal>;
}
