import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { inventoryItems, packagingOptions, products, stockAdjustments } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { assertAdmin } from "@/lib/access-control";
import {
  ensureInventoryItems, lockStockOptions, requireLiveStock, stockBalance, touchStock, type InventoryTx,
} from "@/lib/inventory-ledger";
import type { SessionUser } from "@/lib/domain";

const id = z.number().int().positive();
const count = z.number().int("Informe um número inteiro de caixas.").min(0, "O saldo não pode ser negativo.").max(5_000_000, "Máximo de 5 milhões de caixas.");
const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const metadata = z.object({ name: optionalText(80), location: optionalText(80), notes: optionalText(500) });
const createSchema = metadata.extend({
  productId: id,
  packagingOptionId: id.optional(),
  newPackaging: z.object({
    label: z.string().trim().min(1, "Informe o tipo de embalagem.").max(20),
    unitsPerBox: z.number().int().min(1).max(1000),
  }).optional(),
  balance: count,
}).refine((v) => Boolean(v.packagingOptionId) !== Boolean(v.newPackaging), "Escolha uma embalagem existente ou cadastre uma nova.");
const editSchema = metadata.extend({
  id, revision: z.number().int().min(1), balance: count,
  reason: z.string().trim().min(3, "Informe o motivo da alteração.").max(200),
});
const deleteSchema = z.object({ id, revision: z.number().int().min(1) });

function admin(user: SessionUser) {
  assertAdmin(user, "estoque_itens");
}

/** Ledger imutável para cadastro, edição do saldo e exclusão: não se confunde com ajuste manual editável. */
async function record(tx: InventoryTx, optionId: number, boxes: number, kind: "opening" | "balance_edit" | "item_delete", reason: string, user: SessionUser) {
  await tx.insert(stockAdjustments).values({
    packagingOptionId: optionId, boxes, kind, reason, createdById: user.id, createdByName: user.name,
  });
}

export async function createInventoryItem(user: SessionUser, raw: unknown) {
  admin(user);
  const data = createSchema.parse(raw);
  await ensureInventoryItems();
  return db.transaction(async (tx) => {
    // A trava do produto também serializa cadastros simultâneos de uma embalagem nova.
    const [product] = await tx.select().from(products).where(and(eq(products.id, data.productId), isNull(products.deletedAt), eq(products.active, true))).for("update");
    if (!product) throw new ApiError(404, "Produto não encontrado ou inativo.");
    let optionId = data.packagingOptionId;
    if (data.newPackaging) {
      const { label, unitsPerBox } = data.newPackaging;
      const [existing] = await tx.select().from(packagingOptions).where(and(
        eq(packagingOptions.productId, product.id), eq(packagingOptions.label, label), eq(packagingOptions.unitsPerBox, unitsPerBox),
      ));
      if (existing) optionId = existing.id;
      else {
        const [made] = await tx.insert(packagingOptions).values({ productId: product.id, label, unitsPerBox }).returning({ id: packagingOptions.id });
        optionId = made.id;
      }
    }
    if (!optionId) throw new ApiError(400, "Escolha uma embalagem.");
    const [option] = await lockStockOptions(tx, [optionId]);
    if (option.productId !== product.id || !option.active) throw new ApiError(400, "Essa embalagem não pertence ao produto ou está inativa.");
    const [existing] = await tx.select().from(inventoryItems).where(eq(inventoryItems.packagingOptionId, optionId));
    if (existing && !existing.deletedAt) throw new ApiError(409, "Esse produto e embalagem já estão no estoque. Use Editar na linha do item.");
    const previous = await stockBalance(tx, optionId);
    const meta = { name: data.name, location: data.location, notes: data.notes };
    const [item] = await tx.insert(inventoryItems).values({
      ...meta, packagingOptionId: optionId, source: "manual", createdByName: user.name, updatedByName: user.name,
    }).onConflictDoUpdate({
      target: inventoryItems.packagingOptionId,
      set: { ...meta, source: "manual", deletedAt: null, deletedByName: null, revision: (existing?.revision ?? 0) + 1, updatedByName: user.name, updatedAt: new Date() },
    }).returning({ id: inventoryItems.id });
    await record(tx, optionId, data.balance - previous, "opening", `Cadastro de item de estoque: saldo ${previous} → ${data.balance} caixas.`, user);
    return { id: item.id };
  });
}

async function currentItem(tx: InventoryTx, itemId: number, revision: number) {
  const [found] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
  if (!found) throw new ApiError(404, "Item de estoque não encontrado.");
  await lockStockOptions(tx, [found.packagingOptionId]);
  const item = await requireLiveStock(tx, found.packagingOptionId);
  if (item.revision !== revision) throw new ApiError(409, "O estoque mudou enquanto você editava. Feche esta janela, atualize a lista e tente novamente.");
  return item;
}

export async function updateInventoryItem(user: SessionUser, raw: unknown) {
  admin(user);
  const data = editSchema.parse(raw);
  await ensureInventoryItems();
  await db.transaction(async (tx) => {
    const item = await currentItem(tx, data.id, data.revision);
    const previous = await stockBalance(tx, item.packagingOptionId);
    await tx.update(inventoryItems).set({ name: data.name, location: data.location, notes: data.notes }).where(eq(inventoryItems.id, item.id));
    await record(tx, item.packagingOptionId, data.balance - previous, "balance_edit", `Edição do item: saldo ${previous} → ${data.balance} caixas. ${data.reason}`, user);
    await touchStock(tx, item.packagingOptionId, user);
  });
}

/** Zera o saldo com um movimento identificado e exclui da lista. Nunca apaga uma produção ou expedição passada. */
export async function deleteInventoryItem(user: SessionUser, raw: unknown) {
  admin(user);
  const data = deleteSchema.parse(raw);
  await ensureInventoryItems();
  await db.transaction(async (tx) => {
    const item = await currentItem(tx, data.id, data.revision);
    const previous = await stockBalance(tx, item.packagingOptionId);
    await record(tx, item.packagingOptionId, -previous, "item_delete", `Exclusão do item de estoque: baixa de ${previous} caixas.`, user);
    await tx.update(inventoryItems).set({ deletedAt: new Date(), deletedByName: user.name }).where(eq(inventoryItems.id, item.id));
    await touchStock(tx, item.packagingOptionId, user);
  });
}
