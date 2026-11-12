"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import {
  ACTION_LABEL,
  can,
  featureOn,
  missingForReady,
  ROLE_LABEL,
  type BatchDTO,
  type BoardDTO,
  type ColumnDTO,
  type Role,
  type SessionUser,
  type Status,
  type TransitionAction,
  canUser,
} from "@/lib/domain";
import { api, errMsg } from "@/lib/client";
import { BatchCard } from "@/components/batch-card";
import { BatchDrawer, type DrawerAction } from "@/components/batch-drawer";
import { BatchForm } from "@/components/batch-form";
import {
  FinishDialog,
  ReasonDialog,
  ReleaseDialog,
  ShipDialog,
} from "@/components/dialogs";
import { StockPanel } from "@/components/stock-panel";
import { ACCENT_STYLE, Button, cn, useToast } from "@/components/ui";

type DialogState =
  | { type: "form"; batch?: BatchDTO }
  | { type: "release"; batch: BatchDTO }
  | { type: "reason"; batch: BatchDTO; action: "reter" | "devolver" }
  | { type: "finish"; batch: BatchDTO }
  | { type: "ship" }
  | null;

type DropIntent = Exclude<TransitionAction, "reter">;

/** Transições possíveis a partir de cada status. */
const NEXT: Record<Status, Array<{ action: DropIntent; to: Status }>> = {
  em_preparo: [{ action: "marcar_pronto", to: "pronto" }],
  pronto: [
    { action: "liberar", to: "liberado" },
    { action: "devolver", to: "em_preparo" },
  ],
  retido: [
    { action: "liberar", to: "liberado" },
    { action: "devolver", to: "em_preparo" },
  ],
  liberado: [{ action: "finalizar", to: "em_estoque" }],
  em_estoque: [],
};

function dropIntent(
  batch: BatchDTO,
  target: ColumnDTO,
  who: Pick<SessionUser, "role" | "grants">,
  columns: ColumnDTO[],
): DropIntent | null {
  const hit = NEXT[batch.status].find(
    (x) =>
      target.statuses.includes(x.to) &&
      canUser(who, x.action) &&
      featureOn(columns, x.action, batch.status),
  );
  return hit?.action ?? null;
}

const FALLBACK_COLUMN: ColumnDTO = {
  id: -1,
  name: "Sem painel",
  subtitle: "Status sem coluna configurada",
  accent: "ink",
  position: 999,
  role: "admin",
  statuses: [],
  features: [],
  showStock: false,
  active: true,
  cardCount: 0,
};

const POLL_MS = 8000;

export function Board({ user }: { user: SessionUser }) {
  const toast = useToast();
  const [board, setBoard] = useState<BoardDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState("todas");
  const [tab, setTab] = useState<number | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [drag, setDrag] = useState<BatchDTO | null>(null);

  const refresh = useCallback(async () => {
    try {
      setBoard(await api<BoardDTO>("/api/board"));
      setLoadError(null);
    } catch (e) {
      setLoadError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  const columns = useMemo(
    () => (board?.columns ?? []).filter((c) => c.active),
    [board],
  );
  const brands = useMemo(() => {
    if (!board) return [];
    return [
      ...new Set([
        ...board.products.map((p) => p.brand),
        ...board.batches.map((b) => b.brand),
      ]),
    ];
  }, [board]);
  const filtering = query.trim() !== "" || brand !== "todas";

  // Aba inicial no celular: o painel do perfil logado (ou o primeiro).
  useEffect(() => {
    if (!board) return;
    const ids = columns.map((c) => c.id);
    if (tab === null || !ids.includes(tab)) {
      setTab(columns.find((c) => c.role === user.role)?.id ?? ids[0] ?? -1);
    }
  }, [board, columns, tab, user.role]);

  const grouped = useMemo(() => {
    const map = new Map<number, BatchDTO[]>();
    let orphans: BatchDTO[] = [];
    const q = query.trim().toLowerCase().replace(/^#/, "");
    for (const b of board?.batches ?? []) {
      if (brand !== "todas" && b.brand !== brand) continue;
      if (q) {
        const haystack =
          `${b.number} ${b.brand} ${b.format} ${b.garlicLot ?? ""} ${b.preservativeLot ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      const column = columns.find((c) => c.statuses.includes(b.status));
      if (column) map.set(column.id, [...(map.get(column.id) ?? []), b]);
      else orphans = [...orphans, b];
    }
    // "Pronto" antes de "Retido" quando ambos estão na mesma coluna.
    for (const list of map.values())
      list.sort(
        (a, b) => Number(a.status === "retido") - Number(b.status === "retido"),
      );
    return { map, orphans };
  }, [board, query, brand, columns]);

  const renderColumns = [
    ...columns,
    ...(grouped.orphans.length > 0 ? [FALLBACK_COLUMN] : []),
  ];

  const done = useCallback(
    (message: string) => {
      setDialog(null);
      toast(message);
      void refresh();
    },
    [refresh, toast],
  );

  async function markReady(b: BatchDTO) {
    const missing = missingForReady(b);
    if (missing.length > 0) {
      toast(
        `Faltam ${missing.length} dado(s) para marcar a batelada #${b.number} como Pronto.`,
        "error",
      );
      setDialog({ type: "form", batch: b });
      return;
    }
    try {
      await api(`/api/batches/${b.id}/transition`, {
        method: "POST",
        body: { action: "marcar_pronto" },
      });
      toast(`Batelada #${b.number} enviada à próxima etapa.`);
    } catch (e) {
      toast(errMsg(e), "error");
    }
    void refresh();
  }

  function start(action: DrawerAction | DropIntent, b: BatchDTO) {
    switch (action) {
      case "edit":
        return setDialog({ type: "form", batch: b });
      case "marcar_pronto":
        return void markReady(b);
      case "liberar":
        return setDialog({ type: "release", batch: b });
      case "reter":
      case "devolver":
        return setDialog({ type: "reason", batch: b, action });
      case "finalizar":
        return setDialog({ type: "finish", batch: b });
    }
  }

  const openBatch =
    openId !== null ? board?.batches.find((b) => b.id === openId) : undefined;
  const openColumn = openBatch
    ? columns.find((c) => c.statuses.includes(openBatch.status))
    : undefined;
  const canCreate =
    canUser(user, "criar") && featureOn(columns, "criar", "em_preparo");
  const canShip = canUser(user, "separar") && featureOn(columns, "separar");

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2 pt-3 sm:px-5">
        <h1 className="display mr-2 text-[26px] max-sm:sr-only">
          Painel de produção
        </h1>
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nº, lote ou formato"
            aria-label="Buscar bateladas"
            className="h-11 w-full rounded-lg border border-ink/25 bg-card pl-9 pr-3 text-base outline-none transition placeholder:text-ink-3/80 focus:border-ink focus:ring-2 focus:ring-hivis sm:text-sm"
          />
        </div>
        {brands.length > 1 && (
          <div
            role="group"
            aria-label="Filtrar por marca"
            className="flex overflow-hidden rounded-lg border border-ink/25 bg-card"
          >
            {["todas", ...brands].map((b) => (
              <button
                key={b}
                type="button"
                aria-pressed={brand === b}
                onClick={() => setBrand(b)}
                className={cn(
                  "h-11 px-3 text-[13px] font-bold transition",
                  brand === b
                    ? "bg-ink text-paper"
                    : "text-ink-2 hover:bg-ink/8 hover:text-ink",
                )}
              >
                {b === "todas" ? "Todas" : b}
              </button>
            ))}
          </div>
        )}
        {canCreate && (
          <Button
            variant="hivis"
            className="ml-auto"
            icon={<Plus aria-hidden className="size-4" strokeWidth={3} />}
            onClick={() => setDialog({ type: "form" })}
            disabled={!board}
          >
            Nova batelada
          </Button>
        )}
      </div>

      {loadError && (
        <div
          role="alert"
          className="mx-3 mb-2 flex items-center gap-3 rounded-lg bg-stop-soft px-3 py-2 text-sm font-medium text-stop sm:mx-5"
        >
          <span className="flex-1">
            {board ? "Sem atualização automática no momento. " : ""}
            {loadError}
          </span>
          <Button
            size="sm"
            variant="outline-danger"
            icon={<RefreshCw aria-hidden className="size-3.5" />}
            onClick={() => void refresh()}
          >
            Tentar de novo
          </Button>
        </div>
      )}

      {/* Seletor de painel no celular */}
      <nav
        aria-label="Painéis"
        className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-2 lg:hidden"
      >
        {renderColumns.map((column) => {
          const active = tab === column.id;
          const style = ACCENT_STYLE[column.accent] ?? ACCENT_STYLE.ink;
          return (
            <button
              key={column.id}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(column.id)}
              className={cn(
                "relative min-w-24 flex-1 overflow-hidden rounded-lg border px-1 pb-1.5 pt-2.5 text-center transition",
                active
                  ? "border-ink bg-card"
                  : "border-line bg-paper-deep/60 text-ink-2",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-0 top-0 h-1",
                  style.bar,
                  !active && "opacity-40",
                )}
              />
              <span className="display tnum block text-[22px]">
                {board
                  ? (grouped.map.get(column.id)?.length ??
                    grouped.orphans.length)
                  : "–"}
              </span>
              <span className="mt-0.5 block truncate text-[11px] font-semibold">
                {column.name.split(" ")[0]}
              </span>
            </button>
          );
        })}
      </nav>

      <div
        className="grid min-h-0 flex-1 gap-3 overflow-x-auto px-3 pb-3 sm:px-5 sm:pb-4"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, renderColumns.length)}, minmax(17rem, 1fr))`,
        }}
      >
        {renderColumns.map((column, index) => {
          const style = ACCENT_STYLE[column.accent] ?? ACCENT_STYLE.ink;
          const items =
            column.id === -1
              ? grouped.orphans
              : (grouped.map.get(column.id) ?? []);
          const intent = drag ? dropIntent(drag, column, user, columns) : null;
          const mine = user.role === column.role;
          const isStock = column.statuses.includes("em_estoque");
          const count =
            isStock && board && !filtering ? board.stockedTotal : items.length;

          return (
            <section
              key={column.id}
              aria-label={column.name}
              onDragOver={(e) => {
                if (!intent) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                if (!intent || !drag) return;
                e.preventDefault();
                start(intent, drag);
                setDrag(null);
              }}
              className={cn(
                "relative min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-paper-deep/70 transition lg:flex",
                tab === column.id ? "flex" : "hidden",
                intent ? "border-ink ring-2 ring-ink" : "border-line",
                drag &&
                  !intent &&
                  !column.statuses.includes(drag.status) &&
                  "opacity-50",
              )}
            >
              <span aria-hidden className={cn("h-1.5 shrink-0", style.bar)} />
              <header className="flex shrink-0 items-end justify-between gap-2 px-3 pb-2.5 pt-2.5">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] text-ink-3">
                    {String(index + 1).padStart(2, "0")}
                    {mine && (
                      <span
                        className={cn(
                          "ml-2 font-sans font-bold uppercase tracking-wide",
                          style.text,
                        )}
                      >
                        · sua etapa
                      </span>
                    )}
                  </p>
                  <h2 className="display mt-1 truncate text-[22px]">
                    {column.name}
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-ink-3">
                    {column.subtitle || "—"}
                  </p>
                </div>
                <span
                  className={cn(
                    "tnum grid h-7 min-w-7 shrink-0 place-items-center rounded-md px-1.5 text-[13px] font-bold",
                    style.soft,
                    style.text,
                  )}
                >
                  {board ? count : "–"}
                </span>
              </header>

              {intent && (
                <p className="mx-2.5 mb-2 shrink-0 rounded-md border-2 border-dashed border-ink bg-hivis px-2 py-2 text-center text-xs font-bold text-ink">
                  Solte aqui: {ACTION_LABEL[intent]}
                </p>
              )}

              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-3">
                {!board && !loadError && (
                  <div aria-hidden className="space-y-2.5">
                    {[0, 1].map((i) => (
                      <div
                        key={i}
                        className="h-32 animate-pulse rounded-lg bg-ink/8"
                      />
                    ))}
                  </div>
                )}

                {board && column.showStock && (
                  <StockPanel
                    stock={board.stock}
                    shipments={board.shipments}
                    canShip={canShip}
                    onShip={() => setDialog({ type: "ship" })}
                  />
                )}

                {board && isStock && items.length > 0 && (
                  <p className="px-0.5 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-3">
                    Últimas bateladas finalizadas
                  </p>
                )}

                {board &&
                  items.map((b) => (
                    <BatchCard
                      key={b.id}
                      batch={b}
                      who={user}
                      features={column.features}
                      draggable={renderColumns.some(
                        (c) =>
                          c.id !== -1 &&
                          dropIntent(b, c, user, columns) !== null,
                      )}
                      dragging={drag?.id === b.id}
                      onOpen={() => setOpenId(b.id)}
                      onCta={(kind) => {
                        if (kind === "edit")
                          setDialog({ type: "form", batch: b });
                        else if (kind === "finish")
                          setDialog({ type: "finish", batch: b });
                        else setOpenId(b.id);
                      }}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", String(b.id));
                        e.dataTransfer.effectAllowed = "move";
                        setDrag(b);
                      }}
                      onDragEnd={() => setDrag(null)}
                    />
                  ))}

                {board && items.length === 0 && !column.showStock && (
                  <div className="rounded-lg border border-dashed border-ink/25 px-3 py-6 text-center">
                    <p className="text-sm text-ink-3">
                      {filtering
                        ? "Nada encontrado com este filtro."
                        : column.id === -1
                          ? "Status sem painel configure em Admin › Painéis do quadro."
                          : "Nenhuma batelada nesta etapa."}
                    </p>
                    {column.statuses.includes("em_preparo") &&
                      canCreate &&
                      !filtering && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-3"
                          onClick={() => setDialog({ type: "form" })}
                        >
                          Abrir nova batelada
                        </Button>
                      )}
                    {!mine &&
                      user.role !== "admin" &&
                      !filtering &&
                      column.id !== -1 && (
                        <p className="mt-1 text-xs text-ink-3">
                          Etapa de: {ROLE_LABEL[column.role]}
                        </p>
                      )}
                  </div>
                )}
              </div>
            </section>
          );
        })}
        {board && renderColumns.length === 0 && (
          <div className="grid place-items-center rounded-xl border border-dashed border-ink/30 bg-card p-6 text-center text-sm text-ink-2">
            Nenhum painel ativo. Configure em{" "}
            <strong className="mx-1">Admin › Painéis do quadro</strong>.
          </div>
        )}
      </div>

      {openId !== null && (
        <BatchDrawer
          batchId={openId}
          stamp={
            openBatch
              ? `${openBatch.updatedAt}|${openBatch.attachmentCount}`
              : undefined
          }
          user={user}
          features={openColumn?.features}
          canDelete={featureOn(columns, "excluir", openBatch?.status)}
          onClose={() => setOpenId(null)}
          onAction={start}
          onChanged={() => void refresh()}
        />
      )}

      {dialog?.type === "form" && board && (
        <BatchForm
          batch={dialog.batch}
          products={board.products}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.type === "release" && (
        <ReleaseDialog
          batch={dialog.batch}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.type === "reason" && (
        <ReasonDialog
          batch={dialog.batch}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.type === "finish" && board && (
        <FinishDialog
          batch={dialog.batch}
          product={board.products.find((p) => p.id === dialog.batch.productId)}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog?.type === "ship" && board && (
        <ShipDialog
          stock={board.stock}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      )}
    </div>
  );
}
