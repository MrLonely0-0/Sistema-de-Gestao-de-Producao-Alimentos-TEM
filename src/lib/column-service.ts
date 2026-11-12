import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { kanbanColumns } from "@/db/schema";
import { ApiError } from "@/lib/api";
import {
  ACCENTS,
  COLUMN_FEATURES,
  ROLES,
  STATUSES,
  STATUS_LABEL,
  type SessionUser,
  type Status,
} from "@/lib/domain";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const base = z.object({
  name: z.string().trim().min(1, "Informe o nome do painel.").max(30, "Use no máximo 30 caracteres."),
  subtitle: z.string().trim().max(50, "Use no máximo 50 caracteres."),
  accent: z.enum(ACCENTS),
  role: z.enum(ROLES),
  statuses: z.array(z.enum(STATUSES)),
  features: z.array(z.enum(COLUMN_FEATURES)),
  showStock: z.boolean(),
  active: z.boolean(),
});

export const createColumnSchema = base;
export const updateColumnSchema = z.object({ id: z.number().int().positive() }).merge(base.partial());
export const orderSchema = z.object({ order: z.array(z.number().int().positive()).min(1) });

function adminOnly(user: SessionUser) {
  if (user.role !== "admin") throw new ApiError(403, "Somente o administrador pode configurar os painéis.");
}

async function others(tx: Tx, exceptId?: number) {
  return tx
    .select()
    .from(kanbanColumns)
    .where(and(isNull(kanbanColumns.deletedAt), exceptId ? ne(kanbanColumns.id, exceptId) : undefined));
}

/** Um status não pode aparecer em dois painéis ao mesmo tempo. */
function assertNoOverlap(statuses: Status[], columns: Array<{ name: string; statuses: Status[]; active: boolean }>) {
  for (const column of columns.filter((c) => c.active)) {
    const clash = statuses.filter((s) => column.statuses.includes(s));
    if (clash.length > 0) {
      throw new ApiError(409, `O status ${clash.map((s) => STATUS_LABEL[s]).join(", ")} já está no painel "${column.name}".`);
    }
  }
}

/** Todo status precisa continuar em algum painel ativo. */
function assertCoverage(removed: Status[], columns: Array<{ statuses: Status[]; active: boolean }>) {
  const uncovered = removed.filter((s) => !columns.some((c) => c.active && c.statuses.includes(s)));
  if (uncovered.length > 0) {
    throw new ApiError(409, `Antes disso, coloque ${uncovered.map((s) => STATUS_LABEL[s]).join(", ")} em outro painel.`);
  }
}

export async function createColumn(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const data = createColumnSchema.parse(raw);
  return db.transaction(async (tx) => {
    const list = await others(tx);
    assertNoOverlap(data.statuses, list);
    const position = Math.max(0, ...list.map((c) => c.position)) + 1;
    const [row] = await tx.insert(kanbanColumns).values({ ...data, position }).returning({ id: kanbanColumns.id });
    return { id: row.id };
  });
}

export async function updateColumn(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const { id, ...changes } = updateColumnSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [column] = await tx.select().from(kanbanColumns).where(eq(kanbanColumns.id, id)).for("update");
    if (!column || column.deletedAt) throw new ApiError(404, "Painel não encontrado.");
    const list = await others(tx, id);
    if (changes.statuses) {
      assertNoOverlap(changes.statuses, list);
      const removed = column.statuses.filter((s) => !changes.statuses!.includes(s));
      assertCoverage(removed, list);
    }
    if (changes.active === false || (changes.statuses && changes.statuses.length === 0)) {
      assertCoverage(column.statuses, list);
    }
    await tx.update(kanbanColumns).set(changes).where(eq(kanbanColumns.id, id));
  });
}

export async function deleteColumn(user: SessionUser, id: number) {
  adminOnly(user);
  await db.transaction(async (tx) => {
    const [column] = await tx.select().from(kanbanColumns).where(eq(kanbanColumns.id, id)).for("update");
    if (!column || column.deletedAt) throw new ApiError(404, "Painel não encontrado.");
    const list = await others(tx, id);
    if (list.filter((c) => c.active).length === 0) throw new ApiError(409, "É preciso manter ao menos um painel ativo.");
    assertCoverage(column.statuses, list);
    await tx.update(kanbanColumns).set({ deletedAt: new Date(), active: false }).where(eq(kanbanColumns.id, id));
  });
}

export async function reorderColumns(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const { order } = orderSchema.parse(raw);
  await db.transaction(async (tx) => {
    const list = await tx.select({ id: kanbanColumns.id }).from(kanbanColumns).where(isNull(kanbanColumns.deletedAt));
    const known = new Set(list.map((c) => c.id));
    if (order.some((id) => !known.has(id)) || new Set(order).size !== order.length) {
      throw new ApiError(400, "Ordem inválida. Recarregue a página e tente novamente.");
    }
    for (const [i, id] of order.entries()) {
      await tx.update(kanbanColumns).set({ position: i + 1 }).where(eq(kanbanColumns.id, id));
    }
  });
}

