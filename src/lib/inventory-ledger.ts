import { and, asc, eq, inArray, isNull, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { batchOutputs, inventoryItems, packagingOptions, shipments, stockAdjustments } from "@/db/schema";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/domain";

export type InventoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Toda escrita trava a mesma linha de embalagem, em ordem crescente, antes de calcular o saldo. */
export async function lockStockOptions(tx: InventoryTx, ids: number[]) {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  if (!unique.length) return [];
  const rows = await tx.select().from(packagingOptions)
    .where(inArray(packagingOptions.id, unique)).orderBy(asc(packagingOptions.id)).for("update");
  if (rows.length !== unique.length) throw new ApiError(404, "Embalagem não encontrada.");
  return rows;
}

/** Livro de movimentos: caixas das bateladas + ajustes − separações. Nunca sobrescrevemos a produção. */
export async function stockBalance(tx: InventoryTx, optionId: number) {
  // Uma transação usa uma única conexão: executar sequencialmente evita
  // consultas simultâneas no mesmo cliente do pg (incompatíveis com pg 9).
  const [p] = await tx.select({ n: sum(batchOutputs.boxes) }).from(batchOutputs).where(eq(batchOutputs.packagingOptionId, optionId));
  const [a] = await tx.select({ n: sum(stockAdjustments.boxes) }).from(stockAdjustments).where(and(eq(stockAdjustments.packagingOptionId, optionId), isNull(stockAdjustments.deletedAt)));
  const [s] = await tx.select({ n: sum(shipments.boxes) }).from(shipments).where(eq(shipments.packagingOptionId, optionId));
  return Number(p?.n ?? 0) + Number(a?.n ?? 0) - Number(s?.n ?? 0);
}

export async function requireLiveStock(tx: InventoryTx, optionId: number) {
  const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.packagingOptionId, optionId));
  if (!item || item.deletedAt) throw new ApiError(409, "Este item não está no estoque. O administrador pode cadastrá-lo em Novo item.");
  return item;
}

/** Marca toda mudança de saldo para detectar edição de uma tela desatualizada. */
export async function touchStock(tx: InventoryTx, optionId: number, user: SessionUser) {
  await tx.update(inventoryItems).set({
    revision: sql`${inventoryItems.revision} + 1`, updatedAt: new Date(), updatedByName: user.name,
  }).where(eq(inventoryItems.packagingOptionId, optionId));
}

/** Só é chamado dentro da transação que finaliza uma batelada. Reabre item excluído sem trazer o saldo antigo de volta. */
export async function receiveProduction(tx: InventoryTx, optionId: number, user: SessionUser) {
  await tx.insert(inventoryItems).values({
    packagingOptionId: optionId, source: "production", createdByName: user.name, updatedByName: user.name,
  }).onConflictDoUpdate({
    target: inventoryItems.packagingOptionId,
    set: {
      deletedAt: null, deletedByName: null,
      revision: sql`${inventoryItems.revision} + 1`, updatedAt: new Date(), updatedByName: user.name,
      source: sql`case when ${inventoryItems.deletedAt} is not null then 'production' else ${inventoryItems.source} end`,
    },
  });
}

let initialized: Promise<void> | null = null;

/** Migração não destrutiva dos saldos anteriores ao cadastro de itens. Nunca reabre um registro excluído. */
export function ensureInventoryItems(): Promise<void> {
  initialized ??= db.execute(sql`
    insert into inventory_items (packaging_option_id, source, created_by_name, updated_by_name)
    select p.id, 'import', 'Estoque existente', 'Estoque existente'
    from packaging_options p
    where exists (select 1 from batch_outputs b where b.packaging_option_id = p.id)
       or exists (select 1 from stock_adjustments a where a.packaging_option_id = p.id and a.deleted_at is null)
       or exists (select 1 from shipments s where s.packaging_option_id = p.id)
    on conflict (packaging_option_id) do nothing
  `).then(() => {}).catch((e) => { initialized = null; throw e; });
  return initialized;
}
