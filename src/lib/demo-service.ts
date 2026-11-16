import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appState, batches, batchEvents, batchOutputs, inventoryItems, packagingOptions, products, shipments, stockAdjustments } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { assertAdmin } from "@/lib/access-control";
import { ensureInventoryItems, lockStockOptions, stockBalance, type InventoryTx } from "@/lib/inventory-ledger";
import type { DataMaintenanceDTO, SessionUser } from "@/lib/domain";

const KEY = "lifecycle";

/** Assinaturas exatas dos sete exemplos antigos. Dados criados por pessoas não são rotulados automaticamente. */
const legacySignatures = new Set([
  "1|450 g|AL-2291|CS-0118|1450|22", "1|1 kg|AL-2291|CS-0118|612|9",
  "1|160 g|AL-2304|CS-0121|2400|36", "2|450 g|AL-2304|CS-0121|1380|51",
  "1|450 g|AL-2310|CS-0121|1296|14", "1|2 kg|AL-2310|CS-0122||", "1|160 g|AL-2310|||",
]);
let tagged: Promise<void> | null = null;

export function tagLegacyDemo(): Promise<void> {
  tagged ??= db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7405101)`);
    await tx.insert(appState).values({ id: KEY }).onConflictDoNothing();
    const [state] = await tx.select().from(appState).where(eq(appState.id, KEY));
    if (state.legacyDemoTaggedAt || state.demoCleanedAt) return;
    const candidates = await tx.select().from(batches).where(and(
      eq(batches.isDemo, false), isNull(batches.createdById), isNull(batches.lastChangedById), eq(batches.createdByName, "João Pereira"),
    ));
    const signatures = candidates.filter((b) => b.driveFolderId?.startsWith("sim_") && legacySignatures.has(
      `${b.number}|${b.format}|${b.garlicLot ?? ""}|${b.preservativeLot ?? ""}|${b.goodUnits ?? ""}|${b.lossUnits ?? ""}`,
    ));
    const ids = signatures.map((b) => b.id);
    const authored = ids.length ? await tx.select({ id: batchEvents.batchId }).from(batchEvents).where(and(inArray(batchEvents.batchId, ids), isNotNull(batchEvents.userId))) : [];
    const untouched = signatures.filter((b) => !authored.some((e) => e.id === b.id));
    if (untouched.length) {
      await tx.update(batches).set({ isDemo: true }).where(inArray(batches.id, untouched.map((b) => b.id)));
      // Só a separação que acompanha o exemplo original (mesma embalagem e instante relativo do seed).
      const first = untouched.find((b) => b.number === 1 && b.format === "450 g" && b.goodUnits === 1450);
      if (first) {
        const outs = await tx.select().from(batchOutputs).where(eq(batchOutputs.batchId, first.id));
        const option = outs.find((o) => o.unitsPerBox === 12);
        if (option) {
          const possible = await tx.select().from(shipments).where(and(eq(shipments.packagingOptionId, option.packagingOptionId), eq(shipments.orderRef, "PED-1042"), eq(shipments.createdByName, "Bruno Alves"), eq(shipments.boxes, 30), isNull(shipments.customer)));
          for (const s of possible) {
            if (Math.abs(s.createdAt.getTime() - first.createdAt.getTime() - 32 * 3_600_000) < 60_000) await tx.update(shipments).set({ isDemo: true }).where(eq(shipments.id, s.id));
          }
        }
      }
    }
    await tx.update(appState).set({ legacyDemoTaggedAt: new Date() }).where(eq(appState.id, KEY));
  }).catch((e) => { tagged = null; throw e; });
  return tagged;
}

export async function demoPreviewInTransaction(tx: InventoryTx): Promise<DataMaintenanceDTO> {
  const demo = await tx.select().from(batches).where(eq(batches.isDemo, true)).orderBy(asc(batches.id));
  const outgoing = await tx.select().from(shipments).where(eq(shipments.isDemo, true)).orderBy(asc(shipments.id));
  const [real] = await tx.select({ n: count() }).from(batches).where(and(eq(batches.isDemo, false), isNull(batches.deletedAt)));
  const [state] = await tx.select().from(appState).where(eq(appState.id, KEY));
  const ids = demo.map((b) => b.id);
  const outputs = ids.length ? await tx.select().from(batchOutputs).where(inArray(batchOutputs.batchId, ids)) : [];
  const affected = [...new Set([...outputs.map((o) => o.packagingOptionId), ...outgoing.map((s) => s.packagingOptionId)])].sort((a, b) => a - b);
  const balances: Array<{ id: number; before: number; after: number }> = [];
  const blockers: string[] = [];
  for (const id of affected) {
    const produced = outputs.filter((o) => o.packagingOptionId === id).reduce((a, o) => a + o.boxes, 0);
    const shipped = outgoing.filter((s) => s.packagingOptionId === id).reduce((a, s) => a + s.boxes, 0);
    const before = await stockBalance(tx, id);
    const after = before - produced + shipped;
    balances.push({ id, before, after });
    if (after < 0) {
      const [label] = await tx.select({ brand: products.brand, format: products.format, pack: packagingOptions.label, units: packagingOptions.unitsPerBox }).from(packagingOptions).innerJoin(products, eq(products.id, packagingOptions.productId)).where(eq(packagingOptions.id, id));
      blockers.push(`${label ? `${label.brand} ${label.format} · ${label.pack} c/ ${label.units}` : `Embalagem ${id}`}: movimentos reais dependem de ${-after} caixa(s) de exemplo. Revise os ajustes/expedições antes de limpar.`);
    }
  }
  const version = createHash("sha256").update(JSON.stringify({
    demo: demo.map((b) => [b.id, b.updatedAt]),
    outgoing: outgoing.map((s) => [s.id, s.boxes, s.packagingOptionId, s.orderRef]),
    outputs: outputs.map((o) => [o.id, o.boxes]), balances,
  })).digest("hex");
  return {
    version, demoBatches: demo.length, demoShipments: outgoing.length,
    demoBoxes: outputs.reduce((a, o) => a + o.boxes, 0), realBatches: real.n,
    cleanedAt: state?.demoCleanedAt?.toISOString() ?? null,
    cleanedByName: state?.demoCleanedByName ?? null,
    blockers,
    batches: demo.map((b) => ({ id: b.id, number: b.number, brand: b.brand, format: b.format, status: b.status, createdAt: b.createdAt.toISOString() })),
  };
}

export async function getDemoOverview(user: SessionUser) {
  assertAdmin(user);
  await tagLegacyDemo();
  await ensureInventoryItems();
  return db.transaction((tx) => demoPreviewInTransaction(tx), { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Exportada para testes transacionais com rollback; produção usa clearDemo abaixo. */
export async function clearDemoInTransaction(tx: InventoryTx, user: SessionUser, version: string) {
  assertAdmin(user);
  await tx.execute(sql`select pg_advisory_xact_lock(7405101)`);
  const demo = await tx.select().from(batches).where(eq(batches.isDemo, true)).orderBy(asc(batches.id)).for("update");
  const firstShipments = await tx.select().from(shipments).where(eq(shipments.isDemo, true)).orderBy(asc(shipments.id));
  const ids = demo.map((b) => b.id);
  const outputs = ids.length ? await tx.select().from(batchOutputs).where(inArray(batchOutputs.batchId, ids)) : [];
  const optionIds = [...new Set([...outputs.map((o) => o.packagingOptionId), ...firstShipments.map((s) => s.packagingOptionId)])].sort((a, b) => a - b);
  await lockStockOptions(tx, optionIds);
  const demoShipments = await tx.select().from(shipments).where(eq(shipments.isDemo, true)).orderBy(asc(shipments.id)).for("update");
  if (demoShipments.some((s) => !optionIds.includes(s.packagingOptionId))) throw new ApiError(409, "As separações mudaram. Atualize a prévia e tente novamente.");
  const preview = await demoPreviewInTransaction(tx);
  if (preview.version !== version) throw new ApiError(409, "Os dados mudaram desde a prévia. Atualize a lista e confirme novamente.");
  if (preview.blockers.length) throw new ApiError(409, preview.blockers[0]);
  if (demoShipments.length) await tx.delete(shipments).where(inArray(shipments.id, demoShipments.map((s) => s.id)));
  // Só exemplos marcados: os FKs removem outputs, eventos e anexos dessas bateladas.
  if (ids.length) await tx.delete(batches).where(inArray(batches.id, ids));
  for (const optionId of optionIds) {
    const [remainingProduction] = await tx.select({ n: count() }).from(batchOutputs).where(eq(batchOutputs.packagingOptionId, optionId));
    const [remainingAdjustments] = await tx.select({ n: count() }).from(stockAdjustments).where(and(eq(stockAdjustments.packagingOptionId, optionId), isNull(stockAdjustments.deletedAt)));
    const [remainingShipments] = await tx.select({ n: count() }).from(shipments).where(eq(shipments.packagingOptionId, optionId));
    const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.packagingOptionId, optionId));
    if (!item) continue;
    const onlyDemo = remainingProduction.n + remainingAdjustments.n + remainingShipments.n === 0 && item.source !== "manual";
    await tx.update(inventoryItems).set({
      ...(onlyDemo ? { deletedAt: new Date(), deletedByName: user.name } : {}),
      revision: sql`${inventoryItems.revision} + 1`, updatedAt: new Date(), updatedByName: user.name,
    }).where(eq(inventoryItems.id, item.id));
  }
  // O contador de bateladas é preservado: não reutiliza números que já circularam.
  await tx.insert(appState).values({ id: KEY, demoCleanedAt: new Date(), demoCleanedByName: user.name, demoRemovedBatches: ids.length, demoRemovedShipments: demoShipments.length })
    .onConflictDoUpdate({ target: appState.id, set: { demoCleanedAt: new Date(), demoCleanedByName: user.name, demoRemovedBatches: ids.length, demoRemovedShipments: demoShipments.length } });
  return { ok: true, removedBatches: ids.length, removedShipments: demoShipments.length };
}

export async function clearDemo(user: SessionUser, raw: unknown) {
  assertAdmin(user);
  const input = z.object({ confirmation: z.literal("LIMPAR DEMONSTRAÇÃO", { error: "Digite LIMPAR DEMONSTRAÇÃO para confirmar." }), version: z.string().length(64) }).strict().parse(raw);
  await tagLegacyDemo();
  await ensureInventoryItems();
  return db.transaction((tx) => clearDemoInTransaction(tx, user, input.version));
}
