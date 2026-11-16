import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sum } from "drizzle-orm";
import { db } from "@/db";
import {
  attachments,
  batches,
  batchEvents,
  batchOutputs,
  packagingOptions,
  productClassifications,
  productDimensionValues,
  productDimensions,
  products,
  shipments,
  stockAdjustments,
  users,
} from "@/db/schema";
import { loadColumns } from "@/lib/columns";
import { tagLegacyDemo } from "@/lib/demo-service";
import { getInventoryRows } from "@/lib/inventory-queries";
import { accessProfiles } from "@/db/schema";
import { DRIVE_MODE, DRIVE_ROOT } from "@/lib/drive";
import type {
  AdminOverviewDTO,
  AdjustmentDTO,
  BatchDetailDTO,
  BatchDTO,
  BoardDTO,
  DimensionDTO,
  OutputDTO,
  ProductDTO,
  ReportBatchRow,
  ReportDayPoint,
  ReportFilters,
  ReportProductRow,
  ReportQualityRow,
  ReportsDTO,
  Status,
  StockManageDTO,
  StockRowDTO,
} from "@/lib/domain";
import { STATUSES, STATUS_LABEL, avatarUrl } from "@/lib/domain";

type BatchRow = typeof batches.$inferSelect;
type ProductRow = typeof products.$inferSelect;
type PackagingRow = typeof packagingOptions.$inferSelect;

interface Catalog {
  products: ProductRow[];
  packaging: PackagingRow[];
  dimensions: DimensionDTO[];
  classifications: Array<{ productId: number; dimensionId: number; valueId: number }>;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Converte "160 g", "1 kg"… em um número só para ordenar. */
function weightOf(format: string): number {
  const m = format.replace(",", ".").match(/([\d.]+)\s*(kg|g|ml|l)\b/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const value = parseFloat(m[1]);
  return /^(kg|l)$/i.test(m[2]) ? value * 1000 : value;
}

async function loadCatalog(includeDeleted = false): Promise<Catalog> {
  const [productRows, packagingRows, dimensionRows, valueRows, classificationRows] = await Promise.all([
    db
      .select()
      .from(products)
      .where(includeDeleted ? undefined : isNull(products.deletedAt))
      .orderBy(asc(products.id)),
    db.select().from(packagingOptions).orderBy(asc(packagingOptions.unitsPerBox), asc(packagingOptions.id)),
    db.select().from(productDimensions).orderBy(asc(productDimensions.id)),
    db.select().from(productDimensionValues).orderBy(asc(productDimensionValues.name)),
    db.select().from(productClassifications),
  ]);
  const brandOrder = new Map<string, number>();
  for (const p of productRows) if (!brandOrder.has(p.brand)) brandOrder.set(p.brand, brandOrder.size);
  productRows.sort(
    (a, b) => brandOrder.get(a.brand)! - brandOrder.get(b.brand)! || weightOf(a.format) - weightOf(b.format) || a.id - b.id,
  );
  const liveProductIds = new Set(productRows.filter((p) => !p.deletedAt).map((p) => p.id));
  const dimensions: DimensionDTO[] = dimensionRows.map((d) => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    active: d.active,
    isBrand: d.slug === "marca",
    values: valueRows
      .filter((v) => v.dimensionId === d.id)
      .map((v) => ({
        id: v.id,
        dimensionId: v.dimensionId,
        name: v.name,
        active: v.active,
        productCount: classificationRows.filter((c) => c.valueId === v.id && liveProductIds.has(c.productId)).length,
      })),
  }));
  return {
    products: productRows,
    packaging: packagingRows,
    dimensions,
    classifications: classificationRows,
  };
}

export function toProductDTOs(catalog: Catalog): ProductDTO[] {
  return catalog.products.map((p) => {
    const classifications: Record<number, number | null> = {};
    for (const d of catalog.dimensions) {
      classifications[d.id] = catalog.classifications.find((c) => c.productId === p.id && c.dimensionId === d.id)?.valueId ?? null;
    }
    return {
      id: p.id,
      brand: p.brand,
      format: p.format,
      description: p.description,
      active: p.active,
      nextNumber: p.batchCounter + 1,
      packaging: catalog.packaging
        .filter((o) => o.productId === p.id)
        .map((o) => ({ id: o.id, label: o.label, unitsPerBox: o.unitsPerBox, active: o.active })),
      classifications,
    };
  });
}

/** Nome do valor de uma dimensão (por slug) para um produto. */
function dimensionName(catalog: Catalog, productId: number, slug: string): string | null {
  const dimension = catalog.dimensions.find((d) => d.slug === slug);
  if (!dimension) return null;
  const row = catalog.classifications.find((c) => c.productId === productId && c.dimensionId === dimension.id);
  return dimension.values.find((v) => v.id === row?.valueId)?.name ?? null;
}

function toBatchDTO(b: BatchRow, outputs: OutputDTO[], attachmentCount: number): BatchDTO {
  return {
    id: b.id,
    productId: b.productId,
    number: b.number,
    brand: b.brand,
    format: b.format,
    status: b.status,
    garlicLot: b.garlicLot,
    preservativeLot: b.preservativeLot,
    mixStart: iso(b.mixStart),
    mixEnd: iso(b.mixEnd),
    fillStart: iso(b.fillStart),
    fillEnd: iso(b.fillEnd),
    finishStart: iso(b.finishStart),
    finishEnd: iso(b.finishEnd),
    goodUnits: b.goodUnits,
    lossUnits: b.lossUnits,
    notes: b.notes,
    createdByName: b.createdByName,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
    readyAt: iso(b.readyAt),
    releasedAt: iso(b.releasedAt),
    releasedByName: b.releasedByName,
    qualityNote: b.qualityNote,
    heldAt: iso(b.heldAt),
    finishedAt: iso(b.finishedAt),
    finishedByName: b.finishedByName,
    driveFolderId: b.driveFolderId,
    driveFolderPath: b.driveFolderPath,
    lastChangedById: b.lastChangedById,
    lastChangedByName: b.lastChangedByName,
    lastChangedByRole: b.lastChangedByRole,
    lastChangedAt: iso(b.lastChangedAt),
    outputs,
    attachmentCount,
  };
}

async function hydrate(rows: BatchRow[]): Promise<BatchDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [outputRows, countRows] = await Promise.all([
    db.select().from(batchOutputs).where(inArray(batchOutputs.batchId, ids)).orderBy(asc(batchOutputs.unitsPerBox)),
    db
      .select({ batchId: attachments.batchId, n: count() })
      .from(attachments)
      .where(inArray(attachments.batchId, ids))
      .groupBy(attachments.batchId),
  ]);
  const counts = new Map(countRows.map((c) => [c.batchId, c.n]));
  return rows.map((b) =>
    toBatchDTO(
      b,
      outputRows
        .filter((o) => o.batchId === b.id)
        .map((o) => ({ packagingOptionId: o.packagingOptionId, label: o.label, unitsPerBox: o.unitsPerBox, boxes: o.boxes })),
      counts.get(b.id) ?? 0,
    ),
  );
}

/** Tudo o que o painel Kanban precisa, em uma chamada. */
export async function getBoard(): Promise<BoardDTO> {
  const alive = isNull(batches.deletedAt);
  const [catalog, columns, openRows, stockedRows, stockedCount, stock, shipmentRows] = await Promise.all([
    loadCatalog(),
    loadColumns(),
    db.select().from(batches).where(and(alive, ne(batches.status, "em_estoque"))).orderBy(asc(batches.createdAt)),
    db.select().from(batches).where(and(alive, eq(batches.status, "em_estoque"))).orderBy(desc(batches.finishedAt)).limit(12),
    db.select({ n: count() }).from(batches).where(and(alive, eq(batches.status, "em_estoque"))),
    getInventoryRows(),
    db
      .select({
        id: shipments.id,
        brand: products.brand,
        format: products.format,
        label: packagingOptions.label,
        unitsPerBox: packagingOptions.unitsPerBox,
        boxes: shipments.boxes,
        orderRef: shipments.orderRef,
        customer: shipments.customer,
        createdByName: shipments.createdByName,
        createdAt: shipments.createdAt,
      })
      .from(shipments)
      .innerJoin(packagingOptions, eq(packagingOptions.id, shipments.packagingOptionId))
      .innerJoin(products, eq(products.id, packagingOptions.productId))
      .orderBy(desc(shipments.createdAt))
      .limit(5),
  ]);

  return {
    columns,
    batches: await hydrate([...openRows, ...stockedRows]),
    products: toProductDTOs(catalog).filter((p) => p.active),
    stock,
    shipments: shipmentRows.map((s) => ({
      id: s.id,
      brand: s.brand,
      format: s.format,
      label: `${s.label} c/ ${s.unitsPerBox}`,
      boxes: s.boxes,
      orderRef: s.orderRef,
      customer: s.customer,
      createdByName: s.createdByName,
      createdAt: s.createdAt.toISOString(),
    })),
    stockedTotal: stockedCount[0]?.n ?? 0,
  };
}

export async function getBatchDetail(id: number): Promise<BatchDetailDTO | null> {
  const [row] = await db.select().from(batches).where(eq(batches.id, id));
  if (!row) return null;
  const [[base], attachmentRows, eventRows] = await Promise.all([
    hydrate([row]),
    db.select().from(attachments).where(eq(attachments.batchId, id)).orderBy(desc(attachments.createdAt)),
    db.select().from(batchEvents).where(eq(batchEvents.batchId, id)).orderBy(desc(batchEvents.createdAt), desc(batchEvents.id)),
  ]);
  return {
    ...base,
    attachments: attachmentRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      url: a.url,
      createdById: a.createdById,
      createdByName: a.createdByName,
      createdAt: a.createdAt.toISOString(),
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      userName: e.userName,
      userId: e.userId,
      userRole: e.userRole,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

export async function getAdminOverview(): Promise<AdminOverviewDTO> {
  const [userRows, profileRows, catalog, columns, folderRows, folderCount, attachmentCounts] = await Promise.all([
    db.select().from(users).where(isNull(users.deletedAt)).orderBy(asc(users.id)),
    db.select().from(accessProfiles).where(isNull(accessProfiles.deletedAt)).orderBy(asc(accessProfiles.id)),
    loadCatalog(),
    loadColumns(),
    db
      .select({
        id: batches.id,
        number: batches.number,
        brand: batches.brand,
        format: batches.format,
        path: batches.driveFolderPath,
        folderId: batches.driveFolderId,
        createdAt: batches.createdAt,
      })
      .from(batches)
      .where(isNotNull(batches.driveFolderId))
      .orderBy(desc(batches.createdAt))
      .limit(15),
    db.select({ n: count() }).from(batches).where(isNotNull(batches.driveFolderId)),
    db.select({ batchId: attachments.batchId, n: count() }).from(attachments).groupBy(attachments.batchId),
  ]);
  const perBatch = new Map(attachmentCounts.map((a) => [a.batchId, a.n]));

  return {
    users: userRows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      profileName: profileRows.find((p) => p.id === u.profileId)?.name,
      avatarUrl: avatarUrl(u.id, u.avatarVersion),
      bio: u.bio,
      active: u.active,
      createdAt: u.createdAt.toISOString(),
    })),
    profiles: profileRows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      permissions: p.permissions,
      active: p.active,
      userCount: userRows.filter((u) => u.profileId === p.id).length,
    })),
    products: toProductDTOs(catalog),
    dimensions: catalog.dimensions,
    columns,
    drive: {
      mode: DRIVE_MODE,
      root: DRIVE_ROOT,
      totalFolders: folderCount[0]?.n ?? 0,
      totalAttachments: attachmentCounts.reduce((acc, a) => acc + a.n, 0),
      folders: folderRows.map((f) => ({
        batchId: f.id,
        title: `#${f.number} · ${f.brand} ${f.format}`,
        path: f.path ?? "",
        folderId: f.folderId ?? "",
        attachments: perBatch.get(f.id) ?? 0,
        createdAt: f.createdAt.toISOString(),
      })),
    },
  };
}

/* ───────────── Relatórios ───────────── */

const dayKey = (isoDate: string) => isoDate.slice(0, 10);
const dayLabel = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;

function inPeriod(isoDate: string, filters: ReportFilters): boolean {
  const day = dayKey(isoDate);
  if (filters.from && day < filters.from) return false;
  if (filters.to && day > filters.to) return false;
  return true;
}

/** Agrega em memória (volume de chão de fábrica é pequeno) para manter uma única consulta por tabela. */
export async function getReports(filters: ReportFilters): Promise<ReportsDTO> {
  await tagLegacyDemo();
  const [catalog, batchRows, outputRows, optionRows, productRows, shipmentRows, attachmentRows, adjustmentRows] = await Promise.all([
    loadCatalog(true),
    db.select().from(batches).orderBy(asc(batches.createdAt)),
    db.select().from(batchOutputs),
    db.select().from(packagingOptions),
    db.select().from(products),
    db.select().from(shipments).orderBy(desc(shipments.createdAt)),
    db.select().from(attachments),
    db.select().from(stockAdjustments).where(isNull(stockAdjustments.deletedAt)),
  ]);

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const optionById = new Map(optionRows.map((o) => [o.id, o]));
  const attachmentCount = new Map<number, number>();
  for (const a of attachmentRows) attachmentCount.set(a.batchId, (attachmentCount.get(a.batchId) ?? 0) + 1);

  const eligible = batchRows.filter((b) => {
    if (b.deletedAt && !filters.includeDeleted) return false;
    if (!inPeriod(b.createdAt.toISOString(), filters)) return false;
    if (filters.brand && b.brand !== filters.brand) return false;
    if (filters.productId && b.productId !== filters.productId) return false;
    if (filters.status && b.status !== filters.status) return false;
    return true;
  });
  const eligibleIds = new Set(eligible.map((b) => b.id));
  const outputsByBatch = new Map<number, typeof outputRows>();
  for (const o of outputRows) {
    if (!eligibleIds.has(o.batchId)) continue;
    outputsByBatch.set(o.batchId, [...(outputsByBatch.get(o.batchId) ?? []), o]);
  }

  const hydrated = await hydrate(eligible);
  const rows: ReportBatchRow[] = hydrated.map((b) => {
    const outs = outputsByBatch.get(b.id) ?? [];
    const producedBoxes = outs.reduce((acc, o) => acc + o.boxes, 0);
    const usedUnits = outs.reduce((acc, o) => acc + o.boxes * o.unitsPerBox, 0);
    const good = b.goodUnits ?? 0;
    const loss = b.lossUnits ?? 0;
    return {
      ...b,
      family: dimensionName(catalog, b.productId, "familia"),
      groupName: dimensionName(catalog, b.productId, "grupo"),
      deleted: !!batchRows.find((x) => x.id === b.id)?.deletedAt,
      producedBoxes,
      usedUnits,
      yieldPct: good + loss > 0 ? (good / (good + loss)) * 100 : null,
      leadToReleaseHours:
        b.releasedAt && b.createdAt ? (new Date(b.releasedAt).getTime() - new Date(b.createdAt).getTime()) / 3_600_000 : null,
    };
  });

  /* Por produto */
  const productAgg = new Map<number, ReportProductRow>();
  for (const r of rows) {
    const p = productById.get(r.productId);
    if (!p) continue;
    const agg =
      productAgg.get(r.productId) ??
      ({
        productId: r.productId,
        brand: p.brand,
        format: p.format,
        batches: 0,
        goodUnits: 0,
        lossUnits: 0,
        yieldPct: null,
        boxes: 0,
        released: 0,
        retained: 0,
      } satisfies ReportProductRow);
    agg.batches += 1;
    agg.goodUnits += r.goodUnits ?? 0;
    agg.lossUnits += r.lossUnits ?? 0;
    agg.boxes += r.producedBoxes;
    if (r.releasedAt) agg.released += 1;
    if (r.heldAt || r.status === "retido") agg.retained += 1;
    productAgg.set(r.productId, agg);
  }
  const productReport = [...productAgg.values()]
    .map((p) => ({
      ...p,
      yieldPct: p.goodUnits + p.lossUnits > 0 ? (p.goodUnits / (p.goodUnits + p.lossUnits)) * 100 : null,
    }))
    .sort((a, b) => a.brand.localeCompare(b.brand) || weightOf(a.format) - weightOf(b.format));

  /* Qualidade */
  const quality: ReportQualityRow[] = rows
    .filter((r) => r.readyAt || r.releasedAt || r.heldAt || r.status === "retido")
    .map((r) => ({
      batchId: r.id,
      number: r.number,
      brand: r.brand,
      format: r.format,
      status: r.status,
      readyAt: r.readyAt,
      releasedAt: r.releasedAt,
      releasedByName: r.releasedByName,
      heldAt: r.heldAt,
      qualityNote: r.qualityNote,
      leadHours:
        r.releasedAt && r.readyAt ? (new Date(r.releasedAt).getTime() - new Date(r.readyAt).getTime()) / 3_600_000 : null,
    }));

  /* Saldo atual: usa o mesmo livro do Kanban/gestão, incluindo itens manuais sem batelada.
   * O período/status filtra produção; marca/produto também filtram o estoque. */
  const matchingProducts = new Set(productRows.filter((p) =>
    (!filters.brand || p.brand === filters.brand) && (!filters.productId || p.id === filters.productId),
  ).map((p) => p.id));
  const scopedOptionIds = new Set(optionRows.filter((o) => matchingProducts.has(o.productId)).map((o) => o.id));
  const shipmentsInScope = shipmentRows.filter((s) => scopedOptionIds.has(s.packagingOptionId) && inPeriod(s.createdAt.toISOString(), filters));
  const stock = (await getInventoryRows()).filter((r) => matchingProducts.has(r.productId));
  const adjustedInScope = adjustmentRows.filter((a) => scopedOptionIds.has(a.packagingOptionId) && inPeriod(a.createdAt.toISOString(), filters));

  const shipmentDTOs = shipmentsInScope.map((s) => {
    const o = optionById.get(s.packagingOptionId);
    const p = o ? productById.get(o.productId) : undefined;
    return {
      id: s.id,
      brand: p?.brand ?? "—",
      format: p?.format ?? "—",
      label: o ? `${o.label} c/ ${o.unitsPerBox}` : "—",
      boxes: s.boxes,
      orderRef: s.orderRef,
      customer: s.customer,
      createdByName: s.createdByName,
      createdAt: s.createdAt.toISOString(),
    };
  });

  /* Série diária */
  const days = new Map<string, ReportDayPoint>();
  for (const r of rows) {
    const key = dayKey(r.createdAt);
    const point = days.get(key) ?? { day: key, label: dayLabel(key), batches: 0, goodUnits: 0, boxes: 0 };
    point.batches += 1;
    point.goodUnits += r.goodUnits ?? 0;
    point.boxes += r.producedBoxes;
    days.set(key, point);
  }
  const series = [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-30);

  const goodUnits = rows.reduce((acc, r) => acc + (r.goodUnits ?? 0), 0);
  const lossUnits = rows.reduce((acc, r) => acc + (r.lossUnits ?? 0), 0);
  const boxes = rows.reduce((acc, r) => acc + r.producedBoxes, 0);
  const shippedBoxes = shipmentsInScope.reduce((acc, s) => acc + s.boxes, 0);
  const adjustedBoxes = adjustedInScope.reduce((acc, a) => acc + a.boxes, 0);
  const releaseHours = quality.map((q) => q.leadHours).filter((h): h is number => h !== null && h >= 0);
  const statusBreakdown = STATUSES.map((status) => ({ status, count: rows.filter((r) => r.status === status).length })).filter(
    (x) => x.count > 0,
  );

  return {
    demoBatches: batchRows.filter((b) => b.isDemo).length,
    filters,
    generatedAt: new Date().toISOString(),
    kpis: {
      batches: rows.length,
      goodUnits,
      lossUnits,
      yieldPct: goodUnits + lossUnits > 0 ? (goodUnits / (goodUnits + lossUnits)) * 100 : null,
      boxes,
      adjustedBoxes,
      shipped: shippedBoxes,
      balance: stock.reduce((acc, r) => acc + r.balance, 0),
      released: rows.filter((r) => !!r.releasedAt).length,
      retained: rows.filter((r) => r.status === "retido" || !!r.heldAt).length,
      avgReleaseHours: releaseHours.length ? releaseHours.reduce((a, b) => a + b, 0) / releaseHours.length : null,
      attachments: [...attachmentCount.entries()].filter(([id]) => eligibleIds.has(id)).reduce((acc, [, n]) => acc + n, 0),
    },
    series,
    statusBreakdown,
    batches: rows,
    products: productReport,
    stock,
    shipments: shipmentDTOs,
    quality,
    brands: [...new Set(productRows.map((p) => p.brand))].sort(),
    productsCatalog: productRows.map((p) => ({ id: p.id, brand: p.brand, format: p.format })),
    totalAttachments: eligibleIds.size > 0 ? rows.reduce((acc, r) => acc + r.attachmentCount, 0) : 0,
  };
}

export { STATUS_LABEL };

/* ───────────── Gestão de estoque ───────────── */

export async function getStockManage(): Promise<StockManageDTO> {
  const [catalog, rows, adjustmentRows, shipmentRows, receiptRows] = await Promise.all([
    loadCatalog(true),
    getInventoryRows(),
    db.select().from(stockAdjustments).where(isNull(stockAdjustments.deletedAt)).orderBy(desc(stockAdjustments.createdAt), desc(stockAdjustments.id)).limit(200),
    db.select({
      id: shipments.id, brand: products.brand, format: products.format,
      label: packagingOptions.label, unitsPerBox: packagingOptions.unitsPerBox,
      boxes: shipments.boxes, orderRef: shipments.orderRef, customer: shipments.customer,
      createdByName: shipments.createdByName, createdAt: shipments.createdAt,
    }).from(shipments)
      .innerJoin(packagingOptions, eq(packagingOptions.id, shipments.packagingOptionId))
      .innerJoin(products, eq(products.id, packagingOptions.productId))
      .orderBy(desc(shipments.createdAt), desc(shipments.id)).limit(100),
    db.select({
      id: batchOutputs.id, batchId: batches.id, batchNumber: batches.number,
      brand: batches.brand, format: batches.format, label: batchOutputs.label,
      unitsPerBox: batchOutputs.unitsPerBox, boxes: batchOutputs.boxes,
      finishedAt: batches.finishedAt, finishedByName: batches.finishedByName,
    }).from(batchOutputs).innerJoin(batches, eq(batches.id, batchOutputs.batchId))
      .where(eq(batches.status, "em_estoque"))
      .orderBy(desc(batches.finishedAt), desc(batchOutputs.id)).limit(100),
  ]);
  const liveOptions = new Set(rows.map((r) => r.packagingOptionId));
  const adjustments: AdjustmentDTO[] = adjustmentRows.map((a) => {
    const o = catalog.packaging.find((p) => p.id === a.packagingOptionId);
    const p = catalog.products.find((p) => p.id === o?.productId);
    return {
      id: a.id, packagingOptionId: a.packagingOptionId, productId: o?.productId ?? 0,
      brand: p?.brand ?? "—", format: p?.format ?? "—", label: o?.label ?? "—", unitsPerBox: o?.unitsPerBox ?? 0,
      boxes: a.boxes, reason: a.reason, kind: a.kind,
      canModify: a.kind === "manual" && liveOptions.has(a.packagingOptionId),
      createdByName: a.createdByName, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(),
    };
  });
  return {
    rows, adjustments,
    receipts: receiptRows.filter((r) => r.finishedAt !== null).map((r) => ({ ...r, finishedAt: r.finishedAt!.toISOString() })),
    shipments: shipmentRows.map((s) => ({
      ...s, label: `${s.label} c/ ${s.unitsPerBox}`, createdAt: s.createdAt.toISOString(),
    })),
    products: toProductDTOs(catalog).filter((p) => p.active && !catalog.products.find((r) => r.id === p.id)?.deletedAt)
      .map((p) => ({ id: p.id, brand: p.brand, format: p.format, packaging: p.packaging.filter((o) => o.active) })),
  };
}
