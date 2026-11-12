import { and, eq, inArray, sql, sum } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attachments,
  batches,
  batchEvents,
  batchOutputs,
  packagingOptions,
  products,
  shipments,
} from "@/db/schema";
import { ApiError } from "@/lib/api";
import { assertFeature } from "@/lib/columns";
import { createBatchFolder } from "@/lib/drive";
import {
  ATTACHMENT_KINDS,
  type ColumnFeature,
  can,
  canAttach,
  missingForReady,
  STATUS_LABEL,
  timeOrderErrors,
  TRANSITIONS,
  type Action,
  type ProductionData,
  type SessionUser,
  canUser,
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

const createSchema = productionSchema.extend({
  productId: z.number().int().positive(),
});

const reason = (label: string) =>
  z
    .string()
    .trim()
    .min(3, `Informe o motivo da ${label}.`)
    .max(500, "Use no máximo 500 caracteres.");

const transitionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("marcar_pronto") }),
  z.object({ action: z.literal("liberar") }),
  z.object({ action: z.literal("reter"), reason: reason("retenção") }),
  z.object({ action: z.literal("devolver"), reason: reason("devolução") }),
  z.object({
    action: z.literal("finalizar"),
    outputs: z
      .array(
        z.object({
          packagingOptionId: z.number().int().positive(),
          boxes: z
            .number()
            .int("Use números inteiros de caixas.")
            .min(1, "Informe ao menos 1 caixa.")
            .max(1_000_000),
        }),
      )
      .min(1, "Escolha de 1 a 3 embalagens de saída.")
      .max(3, "Escolha de 1 a 3 embalagens de saída."),
  }),
]);

const attachmentSchema = z.object({
  kind: z.enum(ATTACHMENT_KINDS),
  name: z
    .string()
    .trim()
    .min(2, "Dê um nome ao anexo.")
    .max(120, "Use no máximo 120 caracteres."),
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
  boxes: z
    .number()
    .int("Use números inteiros de caixas.")
    .min(1, "Informe ao menos 1 caixa.")
    .max(1_000_000),
  orderRef: z
    .string()
    .trim()
    .min(1, "Informe o número do pedido.")
    .max(40, "Use no máximo 40 caracteres."),
  customer: optionalText(80),
});

/* ───────────── Auxiliares ───────────── */

function assertCan(user: SessionUser, action: Action) {
  if (!canUser(user, action))
    throw new ApiError(403, "Seu perfil não tem permissão para esta ação.");
}

function assertConsistent(data: ProductionData) {
  const [error] = timeOrderErrors(data);
  if (error) throw new ApiError(400, error);
}

function assertReady(data: ProductionData) {
  const missing = missingForReady(data);
  if (missing.length > 0) {
    throw new ApiError(
      422,
      `Para marcar como Pronto, complete: ${missing.join(", ")}.`,
    );
  }
}

async function logEvent(
  tx: Tx,
  batchId: number,
  type: string,
  message: string,
  user: SessionUser,
) {
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

/* ───────────── Etapa 1 · Produção ───────────── */

export async function createBatch(
  user: SessionUser,
  raw: unknown,
): Promise<{ id: number; number: number }> {
  assertCan(user, "criar");
  await assertFeature("criar", "em_preparo");
  const { productId, markReady, ...data } = createSchema.parse(raw);
  assertConsistent(data);
  if (markReady) assertReady(data);

  return db.transaction(async (tx) => {
    // Incremento atômico: o UPDATE trava a linha do produto, então duas
    // bateladas simultâneas do mesmo item nunca recebem o mesmo número.
    const [product] = await tx
      .update(products)
      .set({ batchCounter: sql`${products.batchCounter} + 1` })
      .where(and(eq(products.id, productId), eq(products.active, true)))
      .returning();
    if (!product) throw new ApiError(404, "Produto não encontrado ou inativo.");

    const number = product.batchCounter;
    const folder = await createBatchFolder({
      brand: product.brand,
      format: product.format,
      number,
    });
    const now = new Date();

    const [batch] = await tx
      .insert(batches)
      .values({
        ...data,
        productId,
        number,
        brand: product.brand,
        format: product.format,
        status: markReady ? "pronto" : "em_preparo",
        readyAt: markReady ? now : null,
        createdById: user.id,
        createdByName: user.name,
        driveFolderId: folder.id,
        driveFolderPath: folder.path,
        ...audit(user, now),
      })
      .returning({ id: batches.id });

    await logEvent(
      tx,
      batch.id,
      "criada",
      `Batelada #${number} aberta em "Em preparo".`,
      user,
    );
    await logEvent(
      tx,
      batch.id,
      "drive",
      `Pasta criada no Drive (simulado): ${folder.path}`,
      user,
    );
    if (markReady)
      await logEvent(
        tx,
        batch.id,
        "pronto",
        "Marcada como Pronto e enviada à Qualidade.",
        user,
      );
    return { id: batch.id, number };
  });
}

export async function updateBatch(
  user: SessionUser,
  id: number,
  raw: unknown,
): Promise<void> {
  assertCan(user, "editar");
  await assertFeature("editar", "em_preparo");
  const { markReady, ...data } = productionSchema.parse(raw);
  assertConsistent(data);
  if (markReady) assertReady(data);

  await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(batches)
      .where(eq(batches.id, id))
      .for("update");
    if (!batch) throw new ApiError(404, "Batelada não encontrada.");
    if (batch.status !== "em_preparo") {
      throw new ApiError(
        409,
        `Esta batelada já está "${STATUS_LABEL[batch.status]}" e não pode mais ser editada.`,
      );
    }
    const now = new Date();
    await tx
      .update(batches)
      .set({
        ...data,
        ...audit(user, now),
        ...(markReady
          ? {
              status: "pronto" as const,
              readyAt: now,
              qualityNote: null,
              heldAt: null,
            }
          : {}),
      })
      .where(eq(batches.id, id));
    await logEvent(tx, id, "editada", "Dados de produção atualizados.", user);
    if (markReady)
      await logEvent(
        tx,
        id,
        "pronto",
        "Marcada como Pronto e enviada à Qualidade.",
        user,
      );
  });
}

/* ───────────── Etapas 1→4 · Movimentação do card ───────────── */

export async function transitionBatch(
  user: SessionUser,
  id: number,
  raw: unknown,
): Promise<void> {
  const payload = transitionSchema.parse(raw);
  assertCan(user, payload.action);

  await db.transaction(async (tx) => {
    // FOR UPDATE: se duas pessoas agirem no mesmo card, a segunda espera e
    // então enxerga o status já alterado.
    const [batch] = await tx
      .select()
      .from(batches)
      .where(eq(batches.id, id))
      .for("update");
    if (!batch) throw new ApiError(404, "Batelada não encontrada.");
    await assertFeature(payload.action as ColumnFeature, batch.status);
    if (!TRANSITIONS[payload.action].from.includes(batch.status)) {
      throw new ApiError(
        409,
        `Esta batelada está "${STATUS_LABEL[batch.status]}" e não permite essa ação. O painel foi atualizado por outra pessoa.`,
      );
    }
    const now = new Date();

    switch (payload.action) {
      case "marcar_pronto": {
        assertReady(batch);
        await tx
          .update(batches)
          .set({
            status: "pronto",
            readyAt: now,
            qualityNote: null,
            heldAt: null,
            updatedAt: now,
          })
          .where(eq(batches.id, id));
        await logEvent(
          tx,
          id,
          "pronto",
          "Marcada como Pronto e enviada à Qualidade.",
          user,
        );
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
        await logEvent(
          tx,
          id,
          "liberado",
          "Lote LIBERADO pela Qualidade. Carimbo de data e hora registrado.",
          user,
        );
        break;
      }
      case "reter": {
        await tx
          .update(batches)
          .set({
            status: "retido",
            qualityNote: payload.reason,
            heldAt: now,
            updatedAt: now,
          })
          .where(eq(batches.id, id));
        await logEvent(
          tx,
          id,
          "retido",
          `Lote RETIDO. Motivo: ${payload.reason}`,
          user,
        );
        break;
      }
      case "devolver": {
        await tx
          .update(batches)
          .set({
            status: "em_preparo",
            readyAt: null,
            qualityNote: payload.reason,
            heldAt: null,
            updatedAt: now,
          })
          .where(eq(batches.id, id));
        await logEvent(
          tx,
          id,
          "devolvido",
          `Devolvida à Produção. Motivo: ${payload.reason}`,
          user,
        );
        break;
      }
      case "finalizar": {
        const ids = payload.outputs.map((o) => o.packagingOptionId);
        if (new Set(ids).size !== ids.length) {
          throw new ApiError(
            400,
            "Cada embalagem só pode ser escolhida uma vez.",
          );
        }
        const options = await tx
          .select()
          .from(packagingOptions)
          .where(
            and(
              eq(packagingOptions.productId, batch.productId),
              inArray(packagingOptions.id, ids),
              eq(packagingOptions.active, true),
            ),
          );
        if (options.length !== ids.length) {
          throw new ApiError(
            400,
            "Há uma embalagem que não está vinculada a este produto. Atualize a página.",
          );
        }
        const lines = payload.outputs.map((o) => {
          const option = options.find((x) => x.id === o.packagingOptionId)!;
          return { option, boxes: o.boxes };
        });
        const totalUnits = lines.reduce(
          (acc, l) => acc + l.boxes * l.option.unitsPerBox,
          0,
        );
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
            finishedAt: now,
            finishedByName: user.name,
            updatedAt: now,
          })
          .where(eq(batches.id, id));
        const summary = lines
          .map(
            (l) => `${l.boxes} × ${l.option.label} c/ ${l.option.unitsPerBox}`,
          )
          .join(" + ");
        await logEvent(
          tx,
          id,
          "finalizado",
          `Acabamento concluído: ${summary}. Enviado ao estoque.`,
          user,
        );
        break;
      }
    }
  });
}

/* ───────────── Exclusão de batelada (somente admin) ───────────── */

export async function deleteBatch(
  user: SessionUser,
  id: number,
): Promise<void> {
  if (user.role !== "admin")
    throw new ApiError(403, "Somente o administrador pode excluir bateladas.");
  await assertFeature("excluir");
  await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(batches)
      .where(eq(batches.id, id))
      .for("update");
    if (!batch) throw new ApiError(404, "Batelada não encontrada.");
    if (batch.deletedAt)
      throw new ApiError(409, "Esta batelada já foi excluída.");
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
      `Batelada #${batch.number} excluída do painel por ${user.name} (Administrador). Histórico preservado nos relatórios.`,
      user,
    );
  });
}

/* ───────────── Anexos (links guardados na pasta do Drive) ───────────── */

export async function addAttachment(
  user: SessionUser,
  batchId: number,
  raw: unknown,
): Promise<void> {
  const data = attachmentSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(batches)
      .where(eq(batches.id, batchId))
      .for("update");
    if (!batch) throw new ApiError(404, "Batelada não encontrada.");
    if (!canAttach(user.role, batch.status)) {
      throw new ApiError(
        403,
        "Seu perfil não pode anexar arquivos a esta batelada nesta etapa.",
      );
    }
    await assertFeature("anexar", batch.status);
    await tx
      .insert(attachments)
      .values({
        ...data,
        batchId,
        createdById: user.id,
        createdByName: user.name,
      });
    await tx
      .update(batches)
      .set({ updatedAt: new Date() })
      .where(eq(batches.id, batchId));
    await logEvent(
      tx,
      batchId,
      "anexo",
      `${data.kind === "laudo" ? "Laudo" : "Foto"} anexado(a): ${data.name}`,
      user,
    );
  });
}

export async function removeAttachment(
  user: SessionUser,
  batchId: number,
  attachmentId: number,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(attachments)
      .where(
        and(eq(attachments.id, attachmentId), eq(attachments.batchId, batchId)),
      );
    if (!row) throw new ApiError(404, "Anexo não encontrado.");
    if (user.role !== "admin" && row.createdById !== user.id) {
      throw new ApiError(
        403,
        "Só quem anexou (ou um administrador) pode remover este anexo.",
      );
    }
    await tx.delete(attachments).where(eq(attachments.id, attachmentId));
    await tx
      .update(batches)
      .set({ updatedAt: new Date() })
      .where(eq(batches.id, batchId));
    await logEvent(tx, batchId, "anexo", `Anexo removido: ${row.name}`, user);
  });
}

/* ───────────── Etapa 4 · Separação para expedição ───────────── */

export async function createShipment(
  user: SessionUser,
  raw: unknown,
): Promise<void> {
  assertCan(user, "separar");
  await assertFeature("separar");
  const data = shipmentSchema.parse(raw);

  await db.transaction(async (tx) => {
    // Trava a embalagem para que duas separações simultâneas não estourem o saldo.
    const [option] = await tx
      .select()
      .from(packagingOptions)
      .where(eq(packagingOptions.id, data.packagingOptionId))
      .for("update");
    if (!option) throw new ApiError(404, "Item de estoque não encontrado.");

    const [[produced], [shipped]] = await Promise.all([
      tx
        .select({ total: sum(batchOutputs.boxes) })
        .from(batchOutputs)
        .where(eq(batchOutputs.packagingOptionId, option.id)),
      tx
        .select({ total: sum(shipments.boxes) })
        .from(shipments)
        .where(eq(shipments.packagingOptionId, option.id)),
    ]);
    const balance = Number(produced?.total ?? 0) - Number(shipped?.total ?? 0);
    if (data.boxes > balance) {
      throw new ApiError(
        409,
        `Saldo insuficiente: há ${balance} caixa(s) disponíveis deste item.`,
      );
    }
    await tx.insert(shipments).values({ ...data, createdByName: user.name });
  });
}
