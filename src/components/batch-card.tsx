"use client";

import type { DragEvent } from "react";
import { Paperclip, ShieldCheck, TriangleAlert, Undo2, UserRound } from "lucide-react";
import {
  can,
  isReadOnly,
  missingForReady,
  READY_TOTAL,
  roleLabel,
  type Action,
  type AdminCapability,
  type BatchDTO,
  type ColumnFeature,
  type Role,
  type Status,
} from "@/lib/domain";
import { fmtAgo, fmtDateTimeSec, fmtInt, fmtShort, packLabel } from "@/lib/client";
import { Button, cn, ProductTag, STATUS_STYLE, StatusPill } from "@/components/ui";

export type CardCta = { kind: "edit" | "inspect" | "finish"; label: string } | null;

/** Ação principal do card para o perfil logado (inclui visualização para demonstração). */
export function ctaFor(
  batch: BatchDTO,
  role: Role,
  features: ColumnFeature[] = [],
  permissions: readonly Action[] = [],
  adminCapabilities?: readonly AdminCapability[],
): CardCta {
  const on = (feature: ColumnFeature) => features.length === 0 || features.includes(feature);
  const viewer = isReadOnly(role);
  if (batch.status === "em_preparo" && (viewer || (can(role, "editar", permissions, adminCapabilities) && on("editar")))) {
    return {
      kind: "edit",
      label: viewer ? "Visualizar edição" : missingForReady(batch).length > 0 ? "Completar dados" : "Revisar e marcar Pronto",
    };
  }
  if ((batch.status === "pronto" || batch.status === "retido") && (viewer || (can(role, "liberar", permissions, adminCapabilities) && on("liberar")))) {
    return {
      kind: "inspect",
      label: viewer ? "Visualizar inspeção" : batch.status === "retido" ? "Reavaliar lote" : "Inspecionar lote",
    };
  }
  if (batch.status === "liberado" && (viewer || (can(role, "finalizar", permissions, adminCapabilities) && on("finalizar")))) {
    return { kind: "finish", label: viewer ? "Visualizar caixas" : "Definir caixas" };
  }
  return null;
}

const AGE: Record<Status, (b: BatchDTO) => [string, string | null]> = {
  em_preparo: (b) => ["aberta", b.createdAt],
  pronto: (b) => ["aguardando", b.readyAt],
  retido: (b) => ["retido", b.heldAt],
  liberado: (b) => ["liberado", b.releasedAt],
  em_estoque: (b) => ["finalizada", b.finishedAt],
};

export function BatchCard({
  batch,
  role,
  features = [],
  permissions = [],
  adminCapabilities,
  draggable,
  dragging,
  onOpen,
  onCta,
  onDragStart,
  onDragEnd,
}: {
  batch: BatchDTO;
  role: Role;
  features?: ColumnFeature[];
  permissions?: readonly Action[];
  adminCapabilities?: readonly AdminCapability[];
  draggable: boolean;
  dragging: boolean;
  onOpen: () => void;
  onCta: (kind: NonNullable<CardCta>["kind"]) => void;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  const cta = ctaFor(batch, role, features, permissions, adminCapabilities);
  const [ageLabel, ageAt] = AGE[batch.status](batch);
  const done = READY_TOTAL - missingForReady(batch).length;

  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "relative overflow-hidden rounded-lg border border-line bg-card shadow-[0_1px_0_rgb(25_27_24/0.08)] transition focus-within:border-ink hover:border-ink/50 hover:shadow-md",
        draggable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", STATUS_STYLE[batch.status].edge)} />

      <div className="py-3 pl-4.5 pr-3">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Abrir batelada ${batch.number}, ${batch.brand} ${batch.format}`}
            className="shrink-0 rounded text-left after:absolute after:inset-0"
          >
            <span className="display tnum block text-[32px]">#{batch.number}</span>
          </button>
          <div className="flex min-w-0 flex-col items-end gap-1">
            <ProductTag brand={batch.brand} format={batch.format} />
            {batch.familyName && (
              <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-3">{batch.familyName}</span>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <StatusPill status={batch.status} />
          {ageAt && (
            <span className="truncate text-[11px] text-ink-3" title={`${ageLabel} ${fmtAgo(ageAt)}`}>
              {/* Em colunas estreitas (notebook) o verbo some; o status ao lado já dá o contexto. */}
              <span className="lg:max-xl:hidden">{ageLabel} </span>
              {fmtAgo(ageAt)}
            </span>
          )}
        </div>

        {(batch.garlicLot || batch.preservativeLot) && (
          <p className="mt-2.5 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-2">
            {batch.garlicLot && (
              <span className="min-w-0 [overflow-wrap:anywhere]">
                alho <span className="font-semibold text-ink">{batch.garlicLot}</span>
              </span>
            )}
            {batch.preservativeLot && (
              <span className="min-w-0 [overflow-wrap:anywhere]">
                cons. <span className="font-semibold text-ink">{batch.preservativeLot}</span>
              </span>
            )}
          </p>
        )}

        {batch.goodUnits !== null && (
          <p className="mt-1 text-[13px] text-ink">
            <span className="tnum font-bold">{fmtInt(batch.goodUnits)}</span> boas
            {batch.lossUnits !== null && (
              <span className="text-ink-3">
                {" "}
                · <span className="tnum">{fmtInt(batch.lossUnits)}</span> perdas
              </span>
            )}
          </p>
        )}

        {batch.status === "em_preparo" && (
          <div className="mt-2.5">
            <div aria-hidden className="flex gap-0.5">
              {Array.from({ length: READY_TOTAL }, (_, i) => (
                <span key={i} className={cn("h-1.5 flex-1 rounded-sm", i < done ? "bg-prod" : "bg-prod/20")} />
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              {done === READY_TOTAL ? "Dados completos — pode marcar Pronto" : `${done} de ${READY_TOTAL} dados preenchidos`}
            </p>
          </div>
        )}

        {batch.qualityNote && batch.status === "retido" && (
          <p className="mt-2.5 flex gap-1.5 rounded-md bg-stop-soft px-2 py-1.5 text-xs text-stop">
            <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-2">{batch.qualityNote}</span>
          </p>
        )}
        {batch.qualityNote && batch.status === "em_preparo" && (
          <p className="mt-2.5 flex gap-1.5 rounded-md bg-prod-soft px-2 py-1.5 text-xs text-prod">
            <Undo2 aria-hidden className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-2">Devolvida pela Qualidade: {batch.qualityNote}</span>
          </p>
        )}

        {batch.releasedAt && (
          <p className="mt-2.5 flex items-start gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wide text-ok">
            <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>
              Liberado <span className="tnum whitespace-nowrap">{fmtDateTimeSec(batch.releasedAt)}</span>
            </span>
          </p>
        )}

        {batch.status === "liberado" && (batch.finishStart || batch.finishEnd) && (
          <p className="mt-1.5 text-[11px] text-acab">
            Acabamento: {batch.finishStart ? `início ${fmtShort(batch.finishStart)}` : "sem início"}
            {batch.finishEnd ? ` · fim ${fmtShort(batch.finishEnd)}` : " · fim pendente"}
          </p>
        )}

        {batch.outputs.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1">
            {batch.outputs.map((o) => (
              <li key={o.packagingOptionId} className="rounded bg-paper-deep px-1.5 py-0.5 text-[11px] font-semibold text-ink">
                <span className="tnum">{fmtInt(o.boxes)}</span> × {packLabel(o.label, o.unitsPerBox)}
              </li>
            ))}
          </ul>
        )}

        {batch.lastChangedByName && (
          <p className="mt-2.5 flex items-start gap-1.5 border-t border-line/70 pt-2 text-[11px] text-ink-3">
            <UserRound aria-hidden className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0">
              Última alteração: <span className="font-semibold text-ink-2">{batch.lastChangedByName}</span>
              {batch.lastChangedByRole && ` · ${roleLabel(batch.lastChangedByRole)}`}
              {batch.lastChangedAt && ` · ${fmtAgo(batch.lastChangedAt)}`}
            </span>
          </p>
        )}

        {(cta || batch.attachmentCount > 0) && (
          <div className="mt-3 flex items-center gap-2">
            {batch.attachmentCount > 0 && (
              <span className="flex items-center gap-1 text-xs font-semibold text-ink-2" title="Anexos na pasta do Drive">
                <Paperclip aria-hidden className="size-3.5" />
                <span className="tnum">{batch.attachmentCount}</span>
                <span className="sr-only">anexo(s)</span>
              </span>
            )}
            {cta && (
              <Button
                size="sm"
                variant={cta.kind === "edit" ? "outline" : "primary"}
                className="relative z-10 ml-auto flex-1"
                onClick={() => onCta(cta.kind)}
              >
                {cta.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
