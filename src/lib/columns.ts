import { asc, count, isNull } from "drizzle-orm";
import { db } from "@/db";
import { batches, kanbanColumns } from "@/db/schema";
import { ApiError } from "@/lib/api";
import { columnsForStatus, type ColumnDTO, type ColumnFeature, type Status } from "@/lib/domain";

/** Colunas ativas em ordem, com a contagem de cards de cada uma. */
export async function loadColumns(): Promise<ColumnDTO[]> {
  const [rows, byStatus] = await Promise.all([
    db.select().from(kanbanColumns).where(isNull(kanbanColumns.deletedAt)).orderBy(asc(kanbanColumns.position), asc(kanbanColumns.id)),
    db
      .select({ status: batches.status, n: count() })
      .from(batches)
      .where(isNull(batches.deletedAt))
      .groupBy(batches.status),
  ]);
  const counts = new Map(byStatus.map((r) => [r.status, r.n]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    subtitle: c.subtitle,
    accent: c.accent as ColumnDTO["accent"],
    position: c.position,
    role: c.role,
    statuses: c.statuses,
    features: c.features,
    showStock: c.showStock,
    active: c.active,
    cardCount: c.statuses.reduce((acc, status) => acc + (counts.get(status) ?? 0), 0),
  }));
}

/**
 * Servidor: RBAC continua valendo e a coluna pode desligar funcionalidades.
 * Se nenhuma coluna usa o status, não bloqueamos (o card fica no painel de
 * contingência e continua operável).
 */
export async function assertFeature(feature: ColumnFeature, status?: Status): Promise<void> {
  const columns = await loadColumns();
  const relevant = status
    ? columnsForStatus(columns, status)
    : feature === "separar"
      ? columns.filter((c) => c.showStock)
      : columns.filter((c) => c.statuses.includes("em_preparo"));
  if (relevant.length > 0 && !relevant.some((c) => c.features.includes(feature))) {
    throw new ApiError(403, `A funcionalidade "${feature}" está desligada neste painel. Habilite-a em Admin › Painéis do quadro.`);
  }
}

/** Garante que todo status tenha ao menos uma coluna antes de excluir/alterar. */
export async function assertStatusesCovered(statuses: Status[], excludingColumnId?: number): Promise<void> {
  const columns = await db.select().from(kanbanColumns).where(isNull(kanbanColumns.deletedAt));
  const others = columns.filter((c) => c.id !== excludingColumnId && c.active);
  const uncovered = statuses.filter((s) => !others.some((c) => c.statuses.includes(s)));
  if (uncovered.length > 0) {
    throw new ApiError(409, "Antes de excluir, mova estes status para outro painel: " + uncovered.join(", "));
  }
}

