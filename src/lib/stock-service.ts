import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { shipments, stockAdjustments } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { assertFeature } from "@/lib/columns";
import { can, type SessionUser } from "@/lib/domain";
import { ensureInventoryItems, lockStockOptions, requireLiveStock, stockBalance, touchStock } from "@/lib/inventory-ledger";

const reason = z.string().trim().min(3, "Informe o motivo do ajuste.").max(200);
const boxes = z.number().int("Use um número inteiro de caixas.").min(-5_000_000).max(5_000_000).refine((v) => v !== 0, "Informe uma quantidade diferente de zero.");
const id = z.number().int().positive();
const createSchema = z.object({ packagingOptionId: id, boxes, reason });
const updateAdjustmentSchema = z.object({ id, boxes: boxes.optional(), reason: reason.optional() });
const updateShipmentSchema = z.object({
  id,
  boxes: z.number().int().min(1).max(1_000_000).optional(),
  orderRef: z.string().trim().min(1).max(40).optional(),
  customer: z.string().trim().max(80).nullable().optional(),
  packagingOptionId: id.optional(),
});

async function guard(user: SessionUser) {
  if (!can(user.role, "separar", user.permissions)) throw new ApiError(403, "Seu perfil não tem permissão para gerenciar o estoque.");
  await assertFeature("separar");
  await ensureInventoryItems();
}

function notNegative(next: number) {
  if (next < 0) throw new ApiError(409, `Operação recusada: o saldo ficaria negativo (${next} caixas).`);
}
function manualOnly(kind: string) {
  if (kind !== "manual") throw new ApiError(409, "Este movimento pertence ao cadastro do item e é preservado para auditoria. Use Editar item para corrigir o saldo.");
}

export async function createAdjustment(user: SessionUser, raw: unknown) {
  await guard(user);
  const data = createSchema.parse(raw);
  await db.transaction(async (tx) => {
    await lockStockOptions(tx, [data.packagingOptionId]);
    await requireLiveStock(tx, data.packagingOptionId);
    notNegative(await stockBalance(tx, data.packagingOptionId) + data.boxes);
    await tx.insert(stockAdjustments).values({ ...data, kind: "manual", createdById: user.id, createdByName: user.name });
    await touchStock(tx, data.packagingOptionId, user);
  });
}

export async function updateAdjustment(user: SessionUser, raw: unknown) {
  await guard(user);
  const { id, ...changes } = updateAdjustmentSchema.parse(raw);
  if (!Object.keys(changes).length) return;
  await db.transaction(async (tx) => {
    const [found] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id));
    if (!found) throw new ApiError(404, "Ajuste não encontrado.");
    await lockStockOptions(tx, [found.packagingOptionId]);
    const [row] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).for("update");
    if (!row || row.deletedAt) throw new ApiError(404, "Ajuste não encontrado.");
    manualOnly(row.kind);
    await requireLiveStock(tx, row.packagingOptionId);
    notNegative(await stockBalance(tx, row.packagingOptionId) + (changes.boxes ?? row.boxes) - row.boxes);
    await tx.update(stockAdjustments).set({ ...changes, updatedAt: new Date() }).where(eq(stockAdjustments.id, id));
    await touchStock(tx, row.packagingOptionId, user);
  });
}

export async function deleteAdjustment(user: SessionUser, id: number) {
  await guard(user);
  await db.transaction(async (tx) => {
    const [found] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id));
    if (!found) throw new ApiError(404, "Ajuste não encontrado.");
    await lockStockOptions(tx, [found.packagingOptionId]);
    const [row] = await tx.select().from(stockAdjustments).where(eq(stockAdjustments.id, id)).for("update");
    if (!row || row.deletedAt) throw new ApiError(404, "Ajuste não encontrado.");
    manualOnly(row.kind);
    await requireLiveStock(tx, row.packagingOptionId);
    notNegative(await stockBalance(tx, row.packagingOptionId) - row.boxes);
    await tx.update(stockAdjustments).set({ deletedAt: new Date(), deletedByName: user.name }).where(eq(stockAdjustments.id, id));
    await touchStock(tx, row.packagingOptionId, user);
  });
}

export async function updateShipment(user: SessionUser, raw: unknown) {
  await guard(user);
  const { id, ...changes } = updateShipmentSchema.parse(raw);
  if (!Object.keys(changes).length) return;
  await db.transaction(async (tx) => {
    const [found] = await tx.select().from(shipments).where(eq(shipments.id, id));
    if (!found) throw new ApiError(404, "Expedição não encontrada.");
    const target = changes.packagingOptionId ?? found.packagingOptionId;
    await lockStockOptions(tx, [found.packagingOptionId, target]);
    const [row] = await tx.select().from(shipments).where(eq(shipments.id, id)).for("update");
    if (!row) throw new ApiError(404, "Expedição não encontrada.");
    if (row.packagingOptionId !== found.packagingOptionId) throw new ApiError(409, "Esta expedição foi alterada. Atualize a lista.");
    await requireLiveStock(tx, row.packagingOptionId);
    await requireLiveStock(tx, target);
    const available = await stockBalance(tx, target) + (target === row.packagingOptionId ? row.boxes : 0);
    if ((changes.boxes ?? row.boxes) > available) throw new ApiError(409, `Saldo insuficiente: há ${available} caixa(s) disponíveis.`);
    await tx.update(shipments).set(changes).where(eq(shipments.id, id));
    for (const optionId of new Set([row.packagingOptionId, target])) await touchStock(tx, optionId, user);
  });
}

export async function deleteShipment(user: SessionUser, id: number) {
  await guard(user);
  await db.transaction(async (tx) => {
    const [found] = await tx.select().from(shipments).where(eq(shipments.id, id));
    if (!found) throw new ApiError(404, "Expedição não encontrada.");
    await lockStockOptions(tx, [found.packagingOptionId]);
    const [row] = await tx.select().from(shipments).where(eq(shipments.id, id)).for("update");
    if (!row) throw new ApiError(404, "Expedição não encontrada.");
    if (row.packagingOptionId !== found.packagingOptionId) throw new ApiError(409, "Esta expedição foi alterada. Atualize a lista.");
    await requireLiveStock(tx, row.packagingOptionId);
    await tx.delete(shipments).where(eq(shipments.id, id));
    await touchStock(tx, row.packagingOptionId, user);
  });
}
