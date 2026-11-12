import { STATUS_LABEL, type ReportDataset, type ReportsDTO } from "@/lib/domain";

/* ───────────── Exportação CSV (Excel pt-BR) ───────────── */

const BOM = "\uFEFF";
const SEP = ";";

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  return BOM + [headers, ...rows].map((r) => r.map(cell).join(SEP)).join("\r\n") + "\r\n";
}

const dt = (iso: string | null) =>
  iso
    ? `${new Date(iso).toLocaleDateString("pt-BR")} ${new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : "";

const dec = (n: number | null, digits = 1) =>
  n === null ? "" : n.toFixed(digits).replace(".", ",");

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function exportContent(dataset: ReportDataset | "completo", format: "csv" | "json", data: ReportsDTO) {
  const stamp = dateStamp();

  if (format === "json") {
    const payload = {
      sistema: "Alimentos TEM · Gestão de Produção e Logística",
      geradoEm: data.generatedAt,
      filtros: data.filters,
      indicadores: data.kpis,
      series: data.series,
      bateladas: data.batches,
      producaoPorProduto: data.products,
      estoque: data.stock,
      expedicoes: data.shipments,
      qualidade: data.quality,
    };
    const content = JSON.stringify(dataset === "completo" ? payload : { ...pickDataset(dataset, data), geradoEm: data.generatedAt, filtros: data.filters }, null, 2);
    return {
      filename: `tem-${dataset}-${stamp}.json`,
      mime: "application/json; charset=utf-8",
      content,
    };
  }

  switch (dataset) {
    case "bateladas":
      return csvFor(
        "bateladas",
        [
          "Batelada", "Marca", "Formato", "Família", "Grupo", "Status", "Criada em", "Criada por",
          "Lote alho", "Lote conservante", "Início mistura", "Fim mistura", "Início envase", "Fim envase",
          "Início acabamento", "Fim acabamento", "Unidades boas", "Perdas", "Rendimento %",
          "Pronto em", "Liberado em", "Liberado por", "Retido em", "Motivo", "Finalizado em", "Finalizado por",
          "Caixas", "Unidades encaixotadas", "Anexos", "Última alteração por", "Perfil", "Última alteração em",
          "Excluída", "Pasta no Drive",
        ],
        data.batches.map((b) => [
          `#${b.number}`, b.brand, b.format, b.family, b.groupName, STATUS_LABEL[b.status], dt(b.createdAt), b.createdByName,
          b.garlicLot, b.preservativeLot, dt(b.mixStart), dt(b.mixEnd), dt(b.fillStart), dt(b.fillEnd),
          dt(b.finishStart), dt(b.finishEnd), b.goodUnits, b.lossUnits, dec(b.yieldPct),
          dt(b.readyAt), dt(b.releasedAt), b.releasedByName, dt(b.heldAt), b.qualityNote, dt(b.finishedAt), b.finishedByName,
          b.producedBoxes, b.usedUnits, b.attachmentCount, b.lastChangedByName,
          b.lastChangedByRole ? perfil(b.lastChangedByRole) : "", dt(b.lastChangedAt),
          b.deleted ? "Sim" : "Não", b.driveFolderPath,
        ]),
      );
    case "producao":
      return csvFor(
        "producao-por-produto",
        ["Marca", "Formato", "Bateladas", "Unidades boas", "Perdas", "Rendimento %", "Caixas", "Liberadas", "Retidas"],
        data.products.map((p) => [p.brand, p.format, p.batches, p.goodUnits, p.lossUnits, dec(p.yieldPct), p.boxes, p.released, p.retained]),
      );
    case "estoque":
      return csvFor(
        "saldo-estoque",
        ["Marca", "Formato", "Embalagem", "Unidades por caixa", "Produzidas", "Ajustes", "Expedidas", "Saldo (caixas)", "Saldo (unidades)"],
        data.stock.map((s) => [s.brand, s.format, `${s.label} c/ ${s.unitsPerBox}`, s.unitsPerBox, s.produced, s.adjusted, s.shipped, s.balance, s.balance * s.unitsPerBox]),
      );
    case "expedicoes":
      return csvFor(
        "expedicoes",
        ["Pedido", "Cliente", "Marca", "Formato", "Embalagem", "Caixas", "Separado por", "Data"],
        data.shipments.map((s) => [s.orderRef, s.customer, s.brand, s.format, s.label, s.boxes, s.createdByName, dt(s.createdAt)]),
      );
    case "qualidade":
      return csvFor(
        "qualidade",
        ["Batelada", "Marca", "Formato", "Status", "Pronto em", "Liberado em", "Liberado por", "Horas até liberar", "Retido em", "Motivo"],
        data.quality.map((q) => [
          `#${q.number}`, q.brand, q.format, STATUS_LABEL[q.status], dt(q.readyAt), dt(q.releasedAt),
          q.releasedByName, dec(q.leadHours), dt(q.heldAt), q.qualityNote,
        ]),
      );
    case "completo": {
      // Um único CSV com todas as bateladas + indicadores no cabeçalho.
      const kpiLines = [
        ["Relatório", "Alimentos TEM"],
        ["Gerado em", dt(data.generatedAt)],
        ["Período", `${data.filters.from ?? "início"} a ${data.filters.to ?? "hoje"}`],
        ["Bateladas", data.kpis.batches],
        ["Unidades boas", data.kpis.goodUnits],
        ["Perdas", data.kpis.lossUnits],
        ["Rendimento %", dec(data.kpis.yieldPct)],
        ["Caixas produzidas", data.kpis.boxes],
        ["Caixas expedidas", data.kpis.shipped],
        ["Saldo", data.kpis.balance],
        ["Liberadas", data.kpis.released],
        ["Retidas", data.kpis.retained],
      ];
      const headers = ["Batelada", "Marca", "Formato", "Status", "Unidades boas", "Perdas", "Caixas", "Liberado em", "Liberado por", "Última alteração por"];
      const rows = data.batches.map((b) => [
        `#${b.number}`, b.brand, b.format, STATUS_LABEL[b.status], b.goodUnits, b.lossUnits, b.producedBoxes,
        dt(b.releasedAt), b.releasedByName, b.lastChangedByName,
      ]);
      const content = BOM + [...kpiLines, [""], headers, ...rows].map((r) => r.map(cell).join(SEP)).join("\r\n") + "\r\n";
      return { filename: `tem-relatorio-completo-${stamp}.csv`, mime: "text/csv; charset=utf-8", content };
    }
  }
}

function csvFor(name: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  return { filename: `tem-${name}-${dateStamp()}.csv`, mime: "text/csv; charset=utf-8", content: csv(headers, rows) };
}

function perfil(role: string): string {
  const map: Record<string, string> = {
    admin: "Administrador",
    producao: "Produção",
    qualidade: "Qualidade",
    acabamento: "Acabamento",
    logistica: "Logística",
  };
  return map[role] ?? role;
}

function pickDataset(dataset: ReportDataset, data: ReportsDTO): Record<string, unknown> {
  switch (dataset) {
    case "bateladas": return { bateladas: data.batches };
    case "producao": return { producaoPorProduto: data.products };
    case "estoque": return { estoque: data.stock };
    case "expedicoes": return { expedicoes: data.shipments };
    case "qualidade": return { qualidade: data.quality };
  }
}
