import { asc, eq, isNull, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { batchOutputs, inventoryItems, packagingOptions, products, shipments, stockAdjustments } from "@/db/schema";
import { ensureInventoryItems } from "@/lib/inventory-ledger";
import type { InventoryRowDTO } from "@/lib/domain";

/** Uma única consulta/visão para estoque e Kanban, inclusive se o produto foi desativado. */
export async function getInventoryRows(): Promise<InventoryRowDTO[]> {
  await ensureInventoryItems();
  const produced = db.select({ optionId: batchOutputs.packagingOptionId, total: sum(batchOutputs.boxes).as("produced_total") })
    .from(batchOutputs).groupBy(batchOutputs.packagingOptionId).as("made");
  const adjusted = db.select({ optionId: stockAdjustments.packagingOptionId, total: sum(stockAdjustments.boxes).as("adjusted_total") })
    .from(stockAdjustments).where(isNull(stockAdjustments.deletedAt)).groupBy(stockAdjustments.packagingOptionId).as("adjusted");
  const shipped = db.select({ optionId: shipments.packagingOptionId, total: sum(shipments.boxes).as("shipped_total") })
    .from(shipments).groupBy(shipments.packagingOptionId).as("shipped");
  const rows = await db.select({
    id: inventoryItems.id,
    packagingOptionId: packagingOptions.id,
    productId: products.id,
    brand: products.brand,
    format: products.format,
    label: packagingOptions.label,
    unitsPerBox: packagingOptions.unitsPerBox,
    name: inventoryItems.name,
    location: inventoryItems.location,
    notes: inventoryItems.notes,
    source: inventoryItems.source,
    revision: inventoryItems.revision,
    updatedAt: inventoryItems.updatedAt,
    updatedByName: inventoryItems.updatedByName,
    produced: sql<string>`coalesce(${produced.total}, 0)`,
    adjusted: sql<string>`coalesce(${adjusted.total}, 0)`,
    shipped: sql<string>`coalesce(${shipped.total}, 0)`,
  }).from(inventoryItems)
    .innerJoin(packagingOptions, eq(packagingOptions.id, inventoryItems.packagingOptionId))
    .innerJoin(products, eq(products.id, packagingOptions.productId))
    .leftJoin(produced, eq(produced.optionId, packagingOptions.id))
    .leftJoin(adjusted, eq(adjusted.optionId, packagingOptions.id))
    .leftJoin(shipped, eq(shipped.optionId, packagingOptions.id))
    .where(isNull(inventoryItems.deletedAt))
    .orderBy(asc(products.brand), asc(products.id), asc(packagingOptions.unitsPerBox));
  return rows.map((r) => ({
    ...r, produced: Number(r.produced), adjusted: Number(r.adjusted), shipped: Number(r.shipped),
    balance: Number(r.produced) + Number(r.adjusted) - Number(r.shipped), updatedAt: r.updatedAt.toISOString(),
  }));
}
