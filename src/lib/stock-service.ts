import { eq, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  batchOutputs,
  packagingOptions,
  shipments,
  stockAdjustments,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import { assertFeature } from "@/lib/columns";
import { can, type SessionUser, canUser } from "@/lib/domain";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const reason = z
  .string()
  .trim()
  .min(3, "Informe o motivo do ajuste.")
  .max(200, "Use no máximo 200 caracteres.");
const boxes = z
  .number()
  .int("Use um número inteiro de caixas.")
  .min(-100000)
  .max(100000)
  .refine((v) => v !== 0, "Informe uma quantidade diferente de zero.");
const optionId = z.number().int().positive();

const createSchema = z.object({ packagingOptionId: optionId, boxes, reason });
const updateAdjustmentSchema = z.object({
  id: z.number().int().positive(),
  boxes: boxes.optional(),
  reason: reason.optional(),
});
const updateShipmentSchema = z.object({
  id: z.number().int().positive(),
  boxes: z
    .number()
    .int("Use um número inteiro de caixas.")
    .min(1, "Informe ao menos 1 caixa.")
    .max(100000)
    .optional(),
  orderRef: z
    .string()
    .trim()
    .min(1, "Informe o número do pedido.")
    .max(40)
    .optional(),
  customer: z
    .string()
    .trim()
    .max(80)
    .nullish()
    .transform((v) => v || null),
  packagingOptionId: optionId.optional(),
});

async function guard(user: SessionUser) {
  if (!canUser(user, "separar"))
    throw new ApiError(
      403,
      "Seu perfil não tem permissão para gerenciar o estoque.",
    );
  await assertFeature("separar");
}

async function optionExists(tx: Tx, id: number) {
  const [row] = await tx
    .select()
    .from(packagingOptions)
    .where(eq(packagingOptions.id, id))
    .for("update");
  if (!row) throw new ApiError(404, "Embalagem não encontrada.");
  return row;
}

/** Saldo = caixas produzidas + ajustes ativos − expedições. */
async function balance(tx: Tx, id: number): Promise<number> {
  const [[p], [s], [a]] = await Promise.all([
    tx
      .select({ total: sum(batchOutputs.boxes) })
      .from(batchOutputs)
      .where(eq(batchOutputs.packagingOptionId, id)),
    tx
      .select({ total: sum(shipments.boxes) })
      .from(shipments)
      .where(eq(shipments.packagingOptionId, id)),
    tx
      .select({ total: sum(stockAdjustments.boxes) })
      .from(stockAdjustments)
      .where(
        sql`${stockAdjustments.packagingOptionId} = ${id} and ${stockAdjustments.deletedAt} is null`,
      ),
  ]);
  return Number(p?.total ?? 0) + Number(a?.total ?? 0) - Number(s?.total ?? 0);
}

function assertNotNegative(next: number, message: string) {
  if (next < 0)
    throw new ApiError(
      409,
      `${message} O saldo ficaria negativo (${next} caixas).`,
    );
}

/* ───────────── Ajustes ───────────── */

export async function createAdjustment(user: SessionUser, raw: unknown) {
  await guard(user);
  const data = createSchema.parse(raw);
  await db.transaction(async (tx) => {
    await optionExists(tx, data.packagingOptionId);
    const current = await balance(tx, data.packagingOptionId);
    assertNotNegative(
      current + data.boxes,
      "Não é possível baixar mais caixas do que há em estoque.",
    );
    await tx.insert(stockAdjustments).values({
      ...data,
      createdById: user.id,
      createdByName: user.name,
    });
  });
}

export async function updateAdjustment(user: SessionUser, raw: unknown) {
  await guard(user);
  const { id, ...changes } = updateAdjustmentSchema.parse(raw);
  if (Object.keys(changes).length === 0) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(stockAdjustments)
      .where(eq(stockAdjustments.id, id))
      .for("update");
    if (!row || row.deletedAt)
      throw new ApiError(404, "Ajuste não encontrado.");
    const nextBoxes = changes.boxes ?? row.boxes;
    const delta = nextBoxes - row.boxes;
    const current = await balance(tx, row.packagingOptionId);
    assertNotNegative(current + delta, "Não é possível alterar este ajuste.");
    await tx
      .update(stockAdjustments)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(stockAdjustments.id, id));
  });
}

/** Exclusão lógica: o ajuste sai da tela, mas o motivo fica no banco para auditoria. */
export async function deleteAdjustment(user: SessionUser, id: number) {
  await guard(user);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(stockAdjustments)
      .where(eq(stockAdjustments.id, id))
      .for("update");
    if (!row || row.deletedAt)
      throw new ApiError(404, "Ajuste não encontrado.");
    const current = await balance(tx, row.packagingOptionId);
    assertNotNegative(
      current - row.boxes,
      "Não é possível excluir este ajuste: ",
    );
    await tx
      .update(stockAdjustments)
      .set({ deletedAt: new Date(), deletedByName: user.name })
      .where(eq(stockAdjustments.id, id));
  });
}

/* ───────────── Expedições ───────────── */

export async function updateShipment(user: SessionUser, raw: unknown) {
  await guard(user);
  const { id, ...changes } = updateShipmentSchema.parse(raw);
  if (Object.keys(changes).length === 0) return;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(shipments)
      .where(eq(shipments.id, id))
      .for("update");
    if (!row) throw new ApiError(404, "Expedição não encontrada.");
    const targetOption = changes.packagingOptionId ?? row.packagingOptionId;
    await optionExists(tx, targetOption);
    const nextBoxes = changes.boxes ?? row.boxes;
    // O saldo disponível devolve as caixas desta expedição antes de comparar.
    const available =
      (await balance(tx, targetOption)) +
      (targetOption === row.packagingOptionId ? row.boxes : 0);
    if (nextBoxes > available) {
      throw new ApiError(
        409,
        `Saldo insuficiente: há ${available} caixa(s) disponíveis para esta expedição.`,
      );
    }
    await tx.update(shipments).set(changes).where(eq(shipments.id, id));
  });
}

export async function deleteShipment(user: SessionUser, id: number) {
  await guard(user);
  const [row] = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.id, id));
  if (!row) throw new ApiError(404, "Expedição não encontrada.");
  await db.delete(shipments).where(eq(shipments.id, id));
}
