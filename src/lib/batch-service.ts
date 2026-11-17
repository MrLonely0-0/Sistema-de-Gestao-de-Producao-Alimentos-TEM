import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  appState,
  attachments,
  batches,
  batchEvents,
  batchOutputs,
  batchProducts,
  productClassifications,
  productDimensions,
  products,
  shipments,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import { assertAdmin } from "@/lib/access-control";
import { ensureInventoryItems, lockStockOptions, receiveProduction, requireLiveStock, stockBalance, touchStock } from "@/lib/inventory-ledger";
import { assertFeature } from "@/lib/columns";
import { createBatchFolder } from "@/lib/drive";
import {
  ATTACHMENT_KINDS,
  type ColumnFeature,
  FAMILY_SLUG,
  finishOrderError,
  hasAdminCapability,
  missingForFinish,
  missingForReady,
  ROLE_LABEL,
  STATUS_LABEL,
  timeOrderErrors,
  TRANSITIONS,
  userCan,
  userCanAttach,
  type Action,
  type ProductionData,
  type SessionUser,
} from "@/lib/domain";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ───────────── Validação de entrada ───────────── */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .nullish()
    .transform((v) => v || null);

const optionalTime = z
  .string()
  .nullish()
  .refine((v) => !v || !Number.isNaN(Date.parse(v)), "Data/hora inválida.")
  .transform((v) => (v ? new Date(v) : null));

const optionalUnits = z
  .number()
  .int("Use apenas números inteiros.")
  .min(0, "A quantidade não pode ser negativa.")
  .max(5_000_000, "Quantidade acima do limite permitido.")
  .nullish()
  .transform((v) => v ?? null);

const productionSchema = z.object({
  garlicLot: optionalText(60),
  preservativeLot: optionalText(60),
  mixStart: optionalTime,
  mixEnd: optionalTime,
  fillStart: optionalTime,
  fillEnd: optionalTime,
  finishStart: optionalTime,
  finishEnd: optionalTime,
  goodUnits: optionalUnits,
  lossUnits: optionalUnits,
  notes: optionalText(1000),
  markReady: z.boolean().optional(),
});

const finishTimesSchema = z.object({
  finishStart: optionalTime,
  finishEnd: optionalTime,
});

const createSchema = productionSchema
  .extend({
    productId: z.number().int().positive().optional(),
    productIds: z
      .array(z.number().int().positive())
      .min(1, "Escolha ao menos uma gramatura.")
      .max(20, "Selecione no máximo 20 gramaturas por batelada.")
      .optional(),
  })
  .refine((d) => d.productId !== undefined || (d.productIds && d.productIds.length > 0), {
    message: "Escolha o produto e a gramatura.",
  });

const reason = (label: string) =>
  z.string().trim().min(3, `Informe o motivo da ${label}.`).max(500, "Use no máximo 500 caracteres.");

const transitionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("marcar_pronto") }),
  z.object({ action: z.literal("liberar") }),
  z.object({ action: z.literal("reter"), reason: reason("retenção") }),
  z.object({ action: z.literal("devolver"), reason: reason("devolução") }),
  z.object({
    action: z.literal("finalizar"),
    finishStart: optionalTime.optional(),
    finishEnd: optionalTime.optional(),
    outputs: z
      .array(
        z.object({
          packagingOptionId: z.number().int().positive(),
          boxes: z.number().int("Use números inteiros de caixas.").min(1, "Informe ao menos 1 caixa.").max(1_000_000),
        }),
      )
      .min(1, "Escolha ao menos 1 embalagem de saída.")
      .max(20, "Escolha no máximo 20 embalagens de saída."),
  }),
]);

const attachmentSchema = z.object({
  kind: z.enum(ATTACHMENT_KINDS),
  name: z.string().trim().min(2, "Dê um nome ao anexo.").max(120, "Use no máximo 120 caracteres."),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => {
      try {
        return ["http:", "https:"].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    }, "Cole um link válido, começando com https://"),
});

const shipmentSchema = z.object({
  packagingOptionId: z.number().int().positive(),
  boxes: z.number().int("Use números inteiros de caixas.").min(1, "Informe ao menos 1 caixa.").max(1_000_000),
  orderRef: z.string().trim().min(1, "Informe o número do pedido.").max(40, "Use no máximo 40 caracteres."),
  customer: optionalText(80),
});

/* ───────────── Auxiliares ───────────── */

function assertCan(user: SessionUser, action: Action) {
  if (!userCan(user, action)) throw new ApiError(403, "Seu perfil não tem permissão para esta ação.");
}

function assertConsistent(data: ProductionData) {
  const [error] = timeOrderErrors(data);
  if (error) throw new ApiError(400, error);
}

function assertReady(data: ProductionData) {
  const missing = missingForReady(data);
  if (missing.length > 0) {
    throw new ApiError(422, `Para marcar como Pronto, complete: ${missing.join(", ")}.`);
  }
}

async function logEvent(tx: Tx, batchId: number, type: string, message: string, user: SessionUser) {
  await tx.insert(batchEvents).values({
    batchId,
    type,
    message,
    userName: user.name,
    userId: user.id,
    userRole: user.role,
  });
}

/** Carimbo de autoria: quem alterou o card por último e com qual perfil. */
function audit(user: SessionUser, now = new Date()) {
  return {
    lastChangedById: user.id,
    lastChangedByName: user.name,
    lastChangedByRole: user.role,
    lastChangedAt: now,
    updatedAt: now,
  };
}

/** Converte "160 g", "1 kg"… em número para manter a ordem das gramaturas consistente. */
function weightOf(format: string): number {
  const m = format.replace(",", ".").match(/([\d.]+)\s*(kg|g|ml|l)\b/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const value = parseFloat(m[1]);
  return /^(kg|l)$/i.test(m[2]) ? value * 1000 : value;
}

/* ───────────── Etapa 1 · Produção ───────────── */

export async function createBatch(user: SessionUser, raw: unknown): Promise<{ id: number; number: number }> {
  assertCan(user, "criar");
  await assertFeature("criar", "em_preparo");
  const { productId, productIds: rawIds, markReady, finishStart: _fs, finishEnd: _fe, ...rest } = createSchema.parse(raw);
  const data = { ...rest, finishStart: null, finishEnd: null };
  const requestedIds = [...new Set(rawIds ?? (productId !== undefined ? [productId] : []))];
  assertConsistent(data);
  if (markReady) {
    await assertFeature("marcar_pronto", "em_preparo");
    assertReady(data);
  }

  return db.transaction(async (tx) => {
    if (requestedIds.length > 1) {
      const [state] = await tx
        .select({ allow: appState.allowMultiFormatBatch })
        .from(appState)
        .where(eq(appState.id, "lifecycle"));
      if (state && !state.allow) {
        throw new ApiError(400, "A seleção de várias gramaturas na mesma batelada está desabilitada pelo administrador.");
      }
    }

    const selected = await tx
      .select()
      .from(products)
      .where(and(inArray(products.id, requestedIds), eq(products.active, true), isNull(products.deletedAt)));
    if (selected.length !== requestedIds.length) {
      throw new ApiError(404, "Produto não encontrado ou inativo.");
    }
    const brands = new Set(selected.map((p) => p.brand));
    if (brands.size > 1) {
      throw new ApiError(400, "Selecione gramaturas da mesma marca na mesma batelada.");
    }

    if (selected.length > 1) {
      const dims = await tx.select().from(productDimensions);
      const familyDim =
        dims.find((d) => d.slug === FAMILY_SLUG) ??
        dims.find((d) => d.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() === FAMILY_SLUG);
      if (familyDim?.active) {
        const classRows = await tx
          .select()
          .from(productClassifications)
          .where(and(inArray(productClassifications.productId, requestedIds), eq(productClassifications.dimensionId, familyDim.id)));
        const byProduct = new Map(classRows.map((c) => [c.productId, c.valueId]));
        const familySet = new Set(requestedIds.map((pid) => byProduct.get(pid) ?? null));
        if (familySet.size > 1) {
          throw new ApiError(400, "Selecione gramaturas da mesma família na mesma batelada.");
        }
      }
    }

    const ordered = [...selected].sort((a, b) => weightOf(a.format) - weightOf(b.format) || a.id - b.id);
    const primaryTarget = ordered[0];
    const combinedFormat = ordered.map((p) => p.format).join(" + ");

    // Incremento atômico: o UPDATE trava a linha do produto principal, então duas
    // bateladas simultâneas do mesmo item nunca recebem o mesmo número.
    const [product] = await tx
      .update(products)
      .set({ batchCounter: sql`${products.batchCounter} + 1` })
      .where(and(eq(products.id, primaryTarget.id), eq(products.active, true), isNull(products.deletedAt)))
      .returning();
    if (!product) throw new ApiError(404, "Produto não encontrado ou inativo.");

    const number = product.batchCounter;
    const folder = await createBatchFolder({ brand: product.brand, format: combinedFormat, number });
    const now = new Date();

    const [batch] = await tx
      .insert(batches)
      .values({
        ...data,
        productId: product.id,
        number,
        brand: product.brand,
        format: combinedFormat,
        status: markReady ? "pronto" : "em_preparo",
        readyAt: markReady ? now : null,
        createdById: user.id,
        createdByName: user.name,
        driveFolderId: folder.id,
        driveFolderPath: folder.path,
        ...audit(user, now),
      })
      .returning({ id: batches.id });

    await tx.insert(batchProducts).values(
      ordered.map((p) => ({
        batchId: batch.id,
        productId: p.id,
        brand: p.brand,
        format: p.format,
      })),
    );

    const suffix = ordered.length > 1 ? ` (${combinedFormat})` : "";
    await logEvent(tx, batch.id, "criada", `Batelada #${number} aberta em "Em preparo"${suffix}.`, user);
    await logEvent(tx, batch.id, "drive", `Pasta criada no Drive (simulado): ${folder.path}`, user);
    if (markReady) await logEvent(tx, batch.id, "pronto", "Marcada como Pronto e enviada à Qualidade.", user);
    return { id: batch.id, number };
  });
}

export async function updateBatch(user: SessionUser, id: number, raw: unknown): Promise<void> {
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batches).where(eq(batches.id, id)).for("update");
    if (!batch || batch.deletedAt) throw new ApiError(404, "Batelada não encontrada.");

    if (batch.status === "liberado") {
      assertCan(user, "finalizar");
      await assertFeature("finalizar", "liberado");
      const { finishStart, finishEnd } = finishTimesSchema.parse(raw);
      const err = finishOrderError({ finishStart, finishEnd });
      if (err) throw new ApiError(400, err);
      const now = new Date();
      await tx
        .update(batches)
        .set({ finishStart, finishEnd, ...audit(user, now) })
        .where(eq(batches.id, id));
      await logEvent(tx, id, "acabamento", "Horários de acabamento atualizados.", user);
      return;
    }

    if (batch.status !== "em_preparo") {
      throw new ApiError(409, `Esta batelada já está "${STATUS_LABEL[batch.status]}" e não pode mais ser editada.`);
    }

    assertCan(user, "editar");
    await assertFeature("editar", "em_preparo");
    const { markReady, finishStart: _fs, finishEnd: _fe, ...rest } = productionSchema.parse(raw);
    const data = { ...rest, finishStart: batch.finishStart, finishEnd: batch.finishEnd };
    assertConsistent(data);
    if (markReady) {
      await assertFeature("marcar_pronto", "em_preparo");
      assertReady(data);
    }

    const now = new Date();
    await tx
      .update(batches)
      .set({
        ...rest,
        ...audit(user, now),
        ...(markReady ? { status: "pronto" as const, readyAt: now, qualityNote: null, heldAt: null } : {}),
      })
      .where(eq(batches.id, id));
    await logEvent(tx, id, "editada", "Dados de produção atualizados.", user);
    if (markReady) await logEvent(tx, id, "pronto", "Marcada como Pronto e enviada à Qualidade.", user);
  });
}

/* ───────────── Etapas 1→4 · Movimentação do card ───────────── */

export async function transitionBatch(user: SessionUser, id: number, raw: unknown): Promise<void> {
  const payload = transitionSchema.parse(raw);
  assertCan(user, payload.action);

  await db.transaction(async (tx) => {
    // FOR UPDATE: se duas pessoas agirem no mesmo card, a segunda espera e
    // então enxerga o status já alterado.
    const [batch] = await tx.select().from(batches).where(eq(batches.id, id)).for("update");
    if (!batch || batch.deletedAt) throw new ApiError(404, "Batelada não encontrada.");
    if (!TRANSITIONS[payload.action].from.includes(batch.status)) {
      throw new ApiError(
        409,
        `Esta batelada está "${STATUS_LABEL[batch.status]}" e não permite essa ação. Atualize o painel.`,
      );
    }
    await assertFeature(payload.action as ColumnFeature, batch.status);
    const now = new Date();

    switch (payload.action) {
      case "marcar_pronto": {
        assertReady(batch);
        await tx
          .update(batches)
          .set({ status: "pronto", readyAt: now, qualityNote: null, heldAt: null, updatedAt: now })
          .where(eq(batches.id, id));
        await logEvent(tx, id, "pronto", "Marcada como Pronto e enviada à Qualidade.", user);
        break;
      }
      case "liberar": {
        // O carimbo usa o relógio do banco e é gravado uma única vez. Depois
        // disso, um trigger (ver lib/seed.ts) rejeita qualquer alteração.
        await tx
          .update(batches)
          .set({
            status: "liberado",
            releasedAt: sql`now()`,
            releasedById: user.id,
            releasedByName: user.name,
            ...audit(user, now),
          })
          .where(eq(batches.id, id));
        await logEvent(tx, id, "liberado", "Lote LIBERADO pela Qualidade. Carimbo de data e hora registrado.", user);
        break;
      }
      case "reter": {
        await tx
          .update(batches)
          .set({ status: "retido", qualityNote: payload.reason, heldAt: now, updatedAt: now })
          .where(eq(batches.id, id));
        await logEvent(tx, id, "retido", `Lote RETIDO. Motivo: ${payload.reason}`, user);
        break;
      }
      case "devolver": {
        await tx
          .update(batches)
          .set({ status: "em_preparo", readyAt: null, qualityNote: payload.reason, heldAt: null, updatedAt: now })
          .where(eq(batches.id, id));
        await logEvent(tx, id, "devolvido", `Devolvida à Produção. Motivo: ${payload.reason}`, user);
        break;
      }
      case "finalizar": {
        const finishStart = payload.finishStart !== undefined ? payload.finishStart : batch.finishStart;
        const finishEnd = payload.finishEnd !== undefined ? payload.finishEnd : batch.finishEnd;
        const finishErr = finishOrderError({ finishStart, finishEnd });
        if (finishErr) throw new ApiError(400, finishErr);
        const missingFinish = missingForFinish({ finishStart, finishEnd });
        if (missingFinish.length > 0) {
          throw new ApiError(422, `Para finalizar o acabamento, complete: ${missingFinish.join(", ")}.`);
        }

        const ids = payload.outputs.map((o) => o.packagingOptionId);
        if (new Set(ids).size !== ids.length) {
          throw new ApiError(400, "Cada embalagem só pode ser escolhida uma vez.");
        }
        const batchProductRows = await tx
          .select({ productId: batchProducts.productId, format: batchProducts.format })
          .from(batchProducts)
          .where(eq(batchProducts.batchId, id))
          .orderBy(asc(batchProducts.id));
        const allowedProductIds = batchProductRows.length > 0 ? batchProductRows.map((r) => r.productId) : [batch.productId];
        const maxOutputs = Math.max(3, allowedProductIds.length * 3);
        if (payload.outputs.length > maxOutputs) {
          throw new ApiError(400, `Escolha de 1 a ${maxOutputs} embalagens de saída.`);
        }

        const options = await lockStockOptions(tx, ids);
        if (options.some((o) => !allowedProductIds.includes(o.productId) || !o.active)) {
          throw new ApiError(400, "Há uma embalagem que não está vinculada aos produtos desta batelada. Atualize a página.");
        }
        const formatByProduct = new Map(batchProductRows.map((r) => [r.productId, r.format]));
        const lines = payload.outputs.map((o) => {
          const option = options.find((x) => x.id === o.packagingOptionId)!;
          return { option, boxes: o.boxes };
        });
        const totalUnits = lines.reduce((acc, l) => acc + l.boxes * l.option.unitsPerBox, 0);
        const good = batch.goodUnits ?? 0;
        if (totalUnits > good) {
          throw new ApiError(
            422,
            `As caixas somam ${totalUnits} unidades, mas a batelada tem apenas ${good} unidades boas.`,
          );
        }
        await tx.insert(batchOutputs).values(
          lines.map((l) => ({
            batchId: id,
            packagingOptionId: l.option.id,
            label: l.option.label,
            unitsPerBox: l.option.unitsPerBox,
            boxes: l.boxes,
          })),
        );
        await tx
          .update(batches)
          .set({
            status: "em_estoque",
            finishStart,
            finishEnd,
            finishedAt: now,
            finishedByName: user.name,
            ...audit(user, now),
          })
          .where(eq(batches.id, id));
        // Produção e entrada no estoque confirmadas na MESMA transação.
        for (const line of lines) await receiveProduction(tx, line.option.id, user);
        const multi = allowedProductIds.length > 1;
        const summary = lines
          .map((l) => {
            const pFormat = formatByProduct.get(l.option.productId);
            const prefix = multi && pFormat ? `${pFormat} · ` : "";
            return `${l.boxes} × ${prefix}${l.option.label} c/ ${l.option.unitsPerBox}`;
          })
          .join(" + ");
        await logEvent(tx, id, "finalizado", `Acabamento concluído: ${summary}. Enviado ao estoque.`, user);
        break;
      }
    }
  });
}

/* ───────────── Exclusão de batelada (somente admin) ───────────── */

export async function deleteBatch(user: SessionUser, id: number): Promise<void> {
  assertAdmin(user, "excluir_bateladas");
  await assertFeature("excluir");
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batches).where(eq(batches.id, id)).for("update");
    if (!batch || batch.deletedAt) throw new ApiError(404, "Batelada não encontrada.");
    if (batch.deletedAt) throw new ApiError(409, "Esta batelada já foi excluída.");
    const now = new Date();
    await tx
      .update(batches)
      .set({
        deletedAt: now,
        deletedById: user.id,
        deletedByName: user.name,
        ...audit(user, now),
      })
      .where(eq(batches.id, id));
    // Exclusão lógica: o card sai do painel, mas caixas, expedições, anexos e
    // histórico continuam íntegros para o estoque, a auditoria e os relatórios.
    await logEvent(
      tx,
      id,
      "excluida",
      `Batelada #${batch.number} excluída do painel por ${user.name} (${ROLE_LABEL[user.role] ?? "Administrador"}). Histórico preservado nos relatórios.`,
      user,
    );
  });
}

/* ───────────── Anexos (links guardados na pasta do Drive) ───────────── */

export async function addAttachment(user: SessionUser, batchId: number, raw: unknown): Promise<void> {
  const data = attachmentSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [batch] = await tx.select().from(batches).where(eq(batches.id, batchId)).for("update");
    if (!batch || batch.deletedAt) throw new ApiError(404, "Batelada não encontrada.");
    if (!userCanAttach(user, batch.status)) {
      throw new ApiError(403, "Seu perfil não pode anexar arquivos a esta batelada nesta etapa.");
    }
    await assertFeature("anexar", batch.status);
    await tx.insert(attachments).values({ ...data, batchId, createdById: user.id, createdByName: user.name });
    await tx.update(batches).set({ updatedAt: new Date() }).where(eq(batches.id, batchId));
    await logEvent(tx, batchId, "anexo", `${data.kind === "laudo" ? "Laudo" : "Foto"} anexado(a): ${data.name}`, user);
  });
}

export async function removeAttachment(user: SessionUser, batchId: number, attachmentId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.batchId, batchId)));
    if (!row) throw new ApiError(404, "Anexo não encontrado.");
    if (!hasAdminCapability(user, "excluir_bateladas") && row.createdById !== user.id) {
      throw new ApiError(403, "Só quem anexou (ou um administrador autorizado) pode remover este anexo.");
    }
    await tx.delete(attachments).where(eq(attachments.id, attachmentId));
    await tx.update(batches).set({ updatedAt: new Date() }).where(eq(batches.id, batchId));
    await logEvent(tx, batchId, "anexo", `Anexo removido: ${row.name}`, user);
  });
}

/* ───────────── Etapa 4 · Separação para expedição ───────────── */

export async function createShipment(user: SessionUser, raw: unknown): Promise<void> {
  assertCan(user, "separar");
  await assertFeature("separar");
  const data = shipmentSchema.parse(raw);
  await ensureInventoryItems();
  await db.transaction(async (tx) => {
    await lockStockOptions(tx, [data.packagingOptionId]);
    await requireLiveStock(tx, data.packagingOptionId);
    const available = await stockBalance(tx, data.packagingOptionId);
    if (data.boxes > available) throw new ApiError(409, `Saldo insuficiente: há ${available} caixa(s) disponíveis deste item.`);
    await tx.insert(shipments).values({ ...data, createdByName: user.name });
    await touchStock(tx, data.packagingOptionId, user);
  });
}
