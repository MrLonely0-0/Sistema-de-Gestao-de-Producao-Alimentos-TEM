"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Database, RefreshCw, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import type { DataMaintenanceDTO } from "@/lib/domain";
import { api, errMsg, fmtDateTime, fmtInt } from "@/lib/client";
import { Button, ErrorNote, Field, inputCls, Modal, PanelCard, SectionTitle, StatusPill, useToast } from "@/components/ui";

export function DataMaintenance({ onChanged }: { onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [data, setData] = useState<DataMaintenanceDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setData(await api<DataMaintenanceDTO>("/api/admin/data")); setError(null); }
    catch (e) { setError(errMsg(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function clear() {
    if (!data) return;
    setBusy(true); setError(null);
    try {
      const result = await api<{ removedBatches: number; removedShipments: number }>("/api/admin/data", { method: "POST", body: { confirmation, version: data.version } });
      setOpen(false); setConfirmation(""); await load(); await onChanged();
      toast(`${result.removedBatches} batelada(s) e ${result.removedShipments} separação(ões) de demonstração removidas.`);
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }
  const count = (data?.demoBatches ?? 0) + (data?.demoShipments ?? 0);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><SectionTitle>Dados do sistema</SectionTitle><p className="max-w-2xl text-sm text-ink-2">Os relatórios são calculados a partir das bateladas, do estoque e das expedições. Não existe uma cópia separada para apagar.</p></div><Button size="sm" variant="outline" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => void load()} disabled={busy}>Atualizar prévia</Button></div>
    <PanelCard>
      <div className="flex items-center gap-2"><Database aria-hidden className="size-5 text-prod" /><h2 className="display text-[24px]">Preparar para uso real</h2></div>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">Se você publicar uma cópia deste banco com os exemplos, eles também irão para o site. Use a limpeza abaixo antes de exportar. Em uma instalação nova, a geração de exemplos já fica desligada por padrão.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        {[['Bateladas de exemplo', data?.demoBatches], ['Separações de exemplo', data?.demoShipments], ['Caixas dos exemplos', data?.demoBoxes], ['Bateladas reais preservadas', data?.realBatches]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-paper-deep/50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-ink-3">{label}</p><p className="display tnum mt-1.5 text-[28px]">{typeof value === "number" ? fmtInt(value) : "–"}</p></div>)}
      </div>
      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-3"><ShieldCheck aria-hidden className="mt-px size-4 shrink-0 text-ok" />Usuários, perfis, produtos, marcas, famílias, embalagens, painéis, conversas e identidade visual são preservados. Registros reais e a sequência de bateladas também são mantidos.</p>
      {data && count === 0 && <p role="status" className="mt-4 flex items-center gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok"><CheckCircle2 aria-hidden className="size-4 shrink-0" />Nenhum dado de demonstração pendente.</p>}
      {data?.cleanedAt && <p className="mt-3 text-xs text-ink-3">Última limpeza: {fmtDateTime(data.cleanedAt)} · {data.cleanedByName}. Os exemplos não serão recriados ao reiniciar.</p>}
    </PanelCard>

    {data && data.batches.length > 0 && <section>
      <SectionTitle>O que será removido</SectionTitle>
      <div className="overflow-x-auto rounded-xl border border-line bg-card"><table className="w-full min-w-[500px] text-left text-[13px]">
        <thead className="bg-paper-deep/60 text-[11px] uppercase tracking-wide text-ink-3"><tr>{["Batelada", "Produto", "Status", "Criada em"].map((h) => <th key={h} scope="col" className="px-3 py-2.5 font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{data.batches.map((b) => <tr key={b.id}><td className="px-3 py-2.5 font-mono font-semibold">#{b.number}</td><td className="px-3 py-2.5">{b.brand} {b.format}</td><td className="px-3 py-2.5"><StatusPill status={b.status} /></td><td className="tnum px-3 py-2.5 text-ink-3">{fmtDateTime(b.createdAt)}</td></tr>)}</tbody>
      </table></div>
    </section>}
    {data?.blockers.map((b) => <p key={b} role="alert" className="flex items-start gap-2 rounded-lg bg-prod-soft p-3 text-sm text-prod"><TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />{b}</p>)}
    <ErrorNote>{!open && error}</ErrorNote>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stop/25 bg-card p-4"><p className="max-w-xl text-xs leading-relaxed text-ink-2">A limpeza é definitiva e remove somente os registros marcados como demonstração, com suas caixas, eventos e anexos. Os saldos são recalculados na mesma operação; nenhuma quantidade pode ficar negativa.</p><Button variant="outline-danger" disabled={!data || count === 0 || !!data.blockers.length || busy} icon={<Trash2 aria-hidden className="size-4" />} onClick={() => { setError(null); setConfirmation(""); setOpen(true); }}>Limpar demonstração</Button></div>
    {open && data && <Modal eyebrow="Admin · dados do sistema" title="Limpar dados de demonstração?" onClose={() => { if (!busy) setOpen(false); }} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button><Button variant="danger" loading={busy} disabled={confirmation !== "LIMPAR DEMONSTRAÇÃO"} onClick={() => void clear()}>Confirmar limpeza</Button></>}>
      <div className="space-y-4"><p className="text-sm leading-relaxed text-ink-2">Serão removidas <strong>{data.demoBatches} batelada(s) de exemplo</strong> e <strong>{data.demoShipments} separação(ões) de exemplo</strong>. Seus cadastros e dados reais serão mantidos.</p><Field label="Digite LIMPAR DEMONSTRAÇÃO para confirmar"><input className={inputCls} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" spellCheck={false} /></Field><ErrorNote>{error}</ErrorNote></div>
    </Modal>}
  </div>;
}
