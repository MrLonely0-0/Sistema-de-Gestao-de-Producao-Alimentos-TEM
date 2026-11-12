"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, Download, FileDown, Filter, RefreshCw } from "lucide-react";
import {
  REPORT_DATASETS,
  STATUS_LABEL,
  type ReportsDTO,
  type ReportDataset,
  type Status,
} from "@/lib/domain";
import { api, errMsg, fmtDateTime, fmtInt, getToken } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, SectionTitle, STAGE_STYLE, StatusPill } from "@/components/ui";

const PERIODS = [
  { id: "7", label: "Últimos 7 dias" },
  { id: "30", label: "Últimos 30 dias" },
  { id: "90", label: "Últimos 90 dias" },
  { id: "all", label: "Todo o período" },
  { id: "custom", label: "Personalizado" },
] as const;

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function defaultRange(period: string): { from: string; to: string } {
  const to = isoDay(new Date());
  if (period === "all" || period === "custom") return { from: "", to: period === "custom" ? to : "" };
  const from = new Date();
  from.setDate(from.getDate() - (Number(period) - 1));
  return { from: isoDay(from), to };
}

function Kpi({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: "hivis" | "ok" | "stop" }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">{label}</p>
      <p className={cn("display tnum mt-1.5 text-[30px]", tone === "ok" && "text-ok", tone === "stop" && "text-stop")}>
        {value}
        {unit && <span className="ml-1.5 text-[13px] tracking-wide text-ink-2">{unit}</span>}
      </p>
    </div>
  );
}

function Table({ headers, rows, empty }: { headers: string[]; rows: Array<Array<ReactNode>>; empty: string }) {
  if (rows.length === 0) return <p className="rounded-lg border border-dashed border-ink/25 px-3 py-5 text-center text-sm text-ink-3">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full min-w-[560px] text-left text-[13px]">
        <thead className="bg-paper-deep/60 text-[11px] uppercase tracking-wide text-ink-3">
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-3 py-2.5 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-paper-deep/30">
              {row.map((cell, j) => (
                <td key={j} className={cn("px-3 py-2.5", j > 0 && "tnum")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsPanel() {
  const [data, setData] = useState<ReportsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("30");
  const range = useMemo(() => defaultRange(period), [period]);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [brand, setBrand] = useState("");
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setFrom(range.from);
    setTo(range.to);
  }, [range.from, range.to]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (brand) p.set("brand", brand);
    if (productId) p.set("productId", productId);
    if (status) p.set("status", status);
    if (includeDeleted) p.set("includeDeleted", "1");
    return p.toString();
  }, [from, to, brand, productId, status, includeDeleted]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<ReportsDTO>(`/api/reports?${query}`));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const pct = (n: number | null) => (n === null ? "—" : `${n.toFixed(1).replace(".", ",")}%`);
  const hours = (n: number | null) => (n === null ? "—" : `${n.toFixed(1).replace(".", ",")} h`);

  function exportHref(dataset: ReportDataset | "completo", format: "csv" | "json") {
    const token = getToken();
    const p = new URLSearchParams(query);
    p.set("dataset", dataset);
    p.set("format", format);
    if (token) p.set("t", token);
    return `/api/reports/export?${p.toString()}`;
  }

  const maxUnits = Math.max(1, ...(data?.series.map((d) => d.goodUnits) ?? [1]));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-3 pb-14 pt-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Indicadores e auditoria</p>
            <h1 className="display mt-1.5 text-[34px]">Relatórios</h1>
          </div>
          <Button variant="outline" icon={<RefreshCw aria-hidden className="size-4" />} onClick={() => setReloadKey((n) => n + 1)} disabled={loading}>
            Atualizar
          </Button>
        </div>

        {/* Filtros */}
        <section className="rounded-xl border border-line bg-card p-4">
          <SectionTitle>Filtros</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Período">
              <select className={inputCls} value={period} onChange={(e) => setPeriod(e.target.value)}>
                {PERIODS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="De">
              <input className={inputCls} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Até">
              <input className={inputCls} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="Marca">
              <select className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">Todas</option>
                {data?.brands.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Produto">
              <select className={inputCls} value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Todos</option>
                {data?.productsCatalog
                  .filter((p) => !brand || p.brand === brand)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.brand} {p.format}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Status">
              <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todos</option>
                {(["em_preparo", "pronto", "retido", "liberado", "em_estoque"] as Status[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex h-11 items-center gap-2.5 self-end rounded-lg border border-ink/25 bg-white px-3 text-sm font-medium text-ink-2 sm:col-span-2 lg:col-span-1">
              <input type="checkbox" className="size-4 accent-ink" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
              Incluir excluídos
            </label>
          </div>
        </section>

        {error && <ErrorNote>{error}</ErrorNote>}
        {!data && !error && (
          <div aria-hidden className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-ink/8" />
            ))}
          </div>
        )}

        {data && (
          <>
            {/* Indicadores */}
            <section aria-label="Indicadores" className={cn("grid gap-3 sm:grid-cols-3 lg:grid-cols-6", loading && "opacity-60")}>
              <Kpi label="Bateladas" value={fmtInt(data.kpis.batches)} tone="hivis" />
              <Kpi label="Unidades boas" value={fmtInt(data.kpis.goodUnits)} />
              <Kpi label="Perdas" value={fmtInt(data.kpis.lossUnits)} tone="stop" />
              <Kpi label="Rendimento" value={pct(data.kpis.yieldPct)} tone="ok" />
              <Kpi label="Caixas / saldo" value={`${fmtInt(data.kpis.boxes)} / ${fmtInt(data.kpis.balance)}`} />
              <Kpi label="Liberações / retenções" value={`${data.kpis.released} / ${data.kpis.retained}`} />
            </section>

            {/* Gráficos */}
            <section className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
              <div className="rounded-xl border border-line bg-card p-4">
                <SectionTitle aside={<span className="text-xs text-ink-3">unidades boas por dia · últimos 30 pontos</span>}>
                  Produção diária
                </SectionTitle>
                {data.series.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-3">Sem bateladas no período selecionado.</p>
                ) : (
                  <div className="flex h-44 items-end gap-1.5 overflow-x-auto pb-1">
                    {data.series.map((d) => (
                      <div key={d.day} className="group flex h-full min-w-6 max-w-16 flex-1 flex-col items-center justify-end gap-1">
                        <div
                          className="w-full shrink-0 rounded-t bg-prod transition group-hover:bg-ink"
                          style={{ height: `${Math.max(4, (d.goodUnits / maxUnits) * 125)}px` }}
                          title={`${d.label}: ${fmtInt(d.batches)} bateladas, ${fmtInt(d.goodUnits)} unidades boas, ${fmtInt(d.boxes)} caixas`}
                        />
                        <span className="tnum whitespace-nowrap text-[10px] text-ink-3">{d.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-line bg-card p-4">
                <SectionTitle>Cards por etapa</SectionTitle>
                {data.statusBreakdown.length === 0 ? (
                  <p className="py-6 text-center text-sm text-ink-3">Sem dados no período.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {data.statusBreakdown.map((s) => {
                      const share = data.kpis.batches ? (s.count / data.kpis.batches) * 100 : 0;
                      const stage = s.status === "em_estoque" ? "estoque" : s.status === "liberado" ? "acabamento" : s.status === "em_preparo" ? "producao" : "qualidade";
                      return (
                        <li key={s.status}>
                          <div className="mb-1 flex items-center justify-between gap-2 text-[13px]">
                            <StatusPill status={s.status} />
                            <span className="tnum font-semibold">{s.count}</span>
                          </div>
                          <div aria-hidden className="h-2 overflow-hidden rounded-full bg-ink/10">
                            <div className={cn("h-full rounded-full", STAGE_STYLE[stage].bar)} style={{ width: `${share}%` }} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-ink-3">Tempo médio até liberar</dt>
                    <dd className="tnum font-bold">{hours(data.kpis.avgReleaseHours)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Anexos / caixas expedidas</dt>
                    <dd className="tnum font-bold">
                      {data.kpis.attachments} / {fmtInt(data.kpis.shipped)}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>

            {/* Exportação */}
            <section className="overflow-hidden rounded-xl border border-ink bg-card">
              <div className="flex flex-wrap items-center gap-2 bg-ink px-4 py-3 text-paper">
                <FileDown aria-hidden className="size-5 text-hivis" />
                <div className="mr-auto">
                  <p className="display text-[20px]">Exportar dados</p>
                  <p className="text-xs text-paper/70">Arquivos respeitam os filtros acima · CSV pronto para Excel pt-BR</p>
                </div>
                <a
                  href={exportHref("completo", "csv")}
                  download
                  className="on-dark flex h-10 items-center gap-2 rounded-lg bg-hivis px-3.5 text-[13px] font-bold text-ink transition hover:brightness-95"
                >
                  <Download aria-hidden className="size-4" />
                  Relatório completo
                </a>
              </div>
              <ul className="divide-y divide-line">
                {REPORT_DATASETS.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-48 flex-1">
                      <p className="text-sm font-semibold">{d.label}</p>
                      <p className="text-xs text-ink-3">{d.description}</p>
                    </div>
                    <a
                      href={exportHref(d.id, "csv")}
                      download
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-ink/25 px-3 text-xs font-bold transition hover:border-ink"
                    >
                      <Download aria-hidden className="size-3.5" /> CSV
                    </a>
                    <a
                      href={exportHref(d.id, "json")}
                      download
                      className="flex h-9 items-center gap-1.5 rounded-lg border border-ink/25 px-3 text-xs font-bold transition hover:border-ink"
                    >
                      <Download aria-hidden className="size-3.5" /> JSON
                    </a>
                  </li>
                ))}
              </ul>
            </section>

            {/* Tabelas */}
            <section>
              <SectionTitle aside={<span className="text-xs text-ink-3">{data.products.length} itens</span>}>Produção por produto</SectionTitle>
              <Table
                headers={["Marca", "Formato", "Bateladas", "Un. boas", "Perdas", "Rendimento", "Caixas", "Liberadas", "Retidas"]}
                rows={data.products.map((p) => [
                  <span className="font-semibold">{p.brand}</span>, p.format, fmtInt(p.batches), fmtInt(p.goodUnits), fmtInt(p.lossUnits), pct(p.yieldPct), fmtInt(p.boxes), p.released, p.retained,
                ])}
                empty="Nenhuma batelada no período."
              />
            </section>

            <div className="grid gap-6 xl:grid-cols-2">
              <section>
                <SectionTitle>Saldo por embalagem</SectionTitle>
                <Table
                  headers={["Produto", "Embalagem", "Produzidas", "Expedidas", "Saldo"]}
                  rows={data.stock.map((s) => [
                    `${s.brand} ${s.format}`,
                    `${s.label} c/ ${s.unitsPerBox}`,
                    fmtInt(s.produced),
                    fmtInt(s.shipped),
                    <span className="font-bold">{fmtInt(s.balance)}</span>,
                  ])}
                  empty="Sem caixas produzidas no período."
                />
              </section>
              <section>
                <SectionTitle>Qualidade</SectionTitle>
                <Table
                  headers={["Batelada", "Produto", "Status", "Liberado em", "Por", "Tempo"]}
                  rows={data.quality.slice(0, 12).map((q) => [
                    `#${q.number}`, `${q.brand} ${q.format}`, <StatusPill status={q.status} />,
                    q.releasedAt ? fmtDateTime(q.releasedAt) : "—", q.releasedByName ?? "—", hours(q.leadHours),
                  ])}
                  empty="Nenhum lote passou pela Qualidade no período."
                />
              </section>
            </div>

            <section>
              <SectionTitle aside={<span className="text-xs text-ink-3">últimas 12</span>}>Expedições</SectionTitle>
              <Table
                headers={["Pedido", "Cliente", "Produto", "Embalagem", "Caixas", "Separado por", "Quando"]}
                rows={data.shipments.slice(0, 12).map((s) => [
                  <span className="font-mono font-semibold">{s.orderRef}</span>, s.customer ?? "—", `${s.brand} ${s.format}`, s.label, fmtInt(s.boxes), s.createdByName, fmtDateTime(s.createdAt),
                ])}
                empty="Nenhuma separação no período."
              />
            </section>

            <section>
              <SectionTitle aside={<span className="text-xs text-ink-3">últimas 15 · quem alterou por último</span>}>Bateladas</SectionTitle>
              <Table
                headers={["Batelada", "Produto", "Família", "Grupo", "Status", "Un. boas", "Caixas", "Última alteração", "Criada em"]}
                rows={[...data.batches].reverse().slice(0, 15).map((b) => [
                  <span className="font-semibold">#{b.number}{b.deleted && <span className="ml-1 text-stop">(excluída)</span>}</span>,
                  `${b.brand} ${b.format}`, b.family ?? "—", b.groupName ?? "—", <StatusPill status={b.status} />,
                  b.goodUnits === null ? "—" : fmtInt(b.goodUnits), fmtInt(b.producedBoxes),
                  b.lastChangedByName ? `${b.lastChangedByName}${b.lastChangedAt ? ` · ${fmtDateTime(b.lastChangedAt)}` : ""}` : "—",
                  fmtDateTime(b.createdAt),
                ])}
                empty="Nenhuma batelada encontrada."
              />
            </section>

            <p className="flex items-center gap-1.5 text-xs text-ink-3">
              <Filter aria-hidden className="size-3.5" />
              Dados gerados em {fmtDateTime(data.generatedAt)} · {data.filters.includeDeleted ? "incluindo registros excluídos" : "registros excluídos omitidos"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
