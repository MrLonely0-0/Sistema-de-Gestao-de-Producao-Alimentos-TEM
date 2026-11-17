import { and, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { kanbanColumns } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { assertAdmin } from "@/lib/access-control";
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
  assertAdmin(user, "admin_paineis");
}

async function others(tx: Tx, exceptId?: number) {
  return tx
    .select()
    .from(kanbanColumns)
    .where(and(isNull(kanbanColumns.deletedAt), exceptId ? ne(kanbanColumns.id, exceptId) : undefined));
}

/** Um status não pode aparecer em dois painéis ao mesmo tempo. */
/** Mantido para compatibilidade: não bloqueia mais, apenas normaliza depois. */
function assertNoOverlap(_statuses: Status[], _columns: Array<{ name: string; statuses: Status[]; active: boolean }>) {
  return;
}

/** Todo status precisa continuar em algum painel ativo. */
/** Status sem painel deixam de bloquear qualquer operação: eles aparecem no
 * painel de contingência "Sem painel" do quadro, e o administrador pode
 * reposicioná-los depois. */
function assertCoverage(_removed: Status[], _columns: Array<{ statuses: Status[]; active: boolean }>) {
  return;
}

/** Ao gravar um painel, o status sai dos outros para o card não aparecer duas vezes. */
async function detachStatuses(tx: Tx, statuses: Status[], keepColumnId?: number) {
  if (statuses.length === 0) return;
  const list = await tx.select().from(kanbanColumns).where(isNull(kanbanColumns.deletedAt));
  for (const column of list) {
    if (column.id === keepColumnId) continue;
    const remaining = column.statuses.filter((s) => !statuses.includes(s));
    if (remaining.length !== column.statuses.length) {
      await tx.update(kanbanColumns).set({ statuses: remaining }).where(eq(kanbanColumns.id, column.id));
    }
  }
}

export async function createColumn(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const data = createColumnSchema.parse(raw);
  return db.transaction(async (tx) => {
    const list = await others(tx);
    const position = Math.max(0, ...list.map((c) => c.position)) + 1;
    await detachStatuses(tx, data.statuses);
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
      await detachStatuses(tx, changes.statuses, id);
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

