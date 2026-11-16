"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Check, Layers, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import type { DimensionDTO, DimensionValueDTO, ProductDTO } from "@/lib/domain";
import { api, packLabel } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal, PanelCard, ProductTag, SectionTitle, Switch, useToast } from "@/components/ui";

export type Run = (fn: () => Promise<unknown>, okMessage?: string) => Promise<boolean>;

type Dialog =
  | { kind: "dimension" }
  | { kind: "dimension-edit"; dimension: DimensionDTO }
  | { kind: "value"; dimensionId: number; value?: DimensionValueDTO }
  | { kind: "product"; product?: ProductDTO }
  | { kind: "bulk" }
  | {
      kind: "confirm";
      title: string;
      body: ReactNode;
      confirmLabel: string;
      action: () => Promise<unknown>;
      ok?: string;
      danger?: boolean;
    }
  | null;

const PACK_TYPES = ["Caixa", "Pack", "Fardo", "Display"];

function SmallCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-line bg-card p-4", className)}>{children}</div>;
}

export function MultiFormatSettingCard({
  allowMultiFormatBatch,
  run,
}: {
  allowMultiFormatBatch: boolean;
  run: Run;
}) {
  return (
    <PanelCard className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Múltiplas gramaturas por batelada</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-3">
          Quando ligado, o operador pode marcar várias gramaturas da mesma marca e família ao criar uma batelada
          (ex.: Feliz 160 g + 450 g). Quando desligado, apenas 1 gramatura pode ser marcada por batelada.
        </p>
      </div>
      <Switch
        checked={allowMultiFormatBatch}
        onChange={(next) =>
          void run(
            () => api("/api/admin/settings", { method: "PATCH", body: { allowMultiFormatBatch: next } }),
            next
              ? "Seleção de múltiplas gramaturas por batelada habilitada."
              : "Seleção restrita a uma gramatura por batelada.",
          )
        }
        label={allowMultiFormatBatch ? "Habilitado" : "Desabilitado"}
      />
    </PanelCard>
  );
}

export function ProductsTab({
  products,
  dimensions,
  allowMultiFormatBatch,
  run,
}: {
  products: ProductDTO[];
  dimensions: DimensionDTO[];
  allowMultiFormatBatch: boolean;
  run: Run;
}) {
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [groupBy, setGroupBy] = useState<string>("brand");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]);

  const activeDimensions = dimensions.filter((d) => d.active);
  const brandDim = dimensions.find((d) => d.isBrand);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !`${p.brand} ${p.format} ${p.description ?? ""}`.toLowerCase().includes(q)) return false;
      return activeDimensions.every((d) => {
        const picked = filters[d.id];
        return !picked || String(p.classifications[d.id] ?? "") === picked;
      });
    });
  }, [products, activeDimensions, filters, query]);

  const toggleSelected = (id: number) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.includes(p.id));
  const selectedVisible = selected.filter((id) => products.some((p) => p.id === id));

  const activeFilter = activeDimensions.find((d) => filters[d.id]);
  const activeFilterValue = activeFilter
    ? activeFilter.values.find((v) => String(v.id) === filters[activeFilter.id])?.name
    : null;
  const grammages = [...new Set(visible.map((p) => p.format))].sort();

  const groups = useMemo(() => {
    const map = new Map<string, ProductDTO[]>();
    for (const p of visible) {
      let key = "Todos os produtos";
      if (groupBy === "brand") key = p.brand;
      else {
        const dim = dimensions.find((d) => String(d.id) === groupBy);
        const valueId = dim ? p.classifications[dim.id] : null;
        key = `${dim?.name ?? "—"}: ${dim?.values.find((v) => v.id === valueId)?.name ?? "Sem classificação"}`;
      }
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [visible, groupBy, dimensions]);

  async function submit(action: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setDialogError(null);
    const okDone = await run(action, ok);
    setBusy(false);
    if (okDone) setDialog(null);
  }

  const valueName = (dimensionId: number, valueId: number | null) =>
    dimensions.find((d) => d.id === dimensionId)?.values.find((v) => v.id === valueId)?.name ?? null;

  return (
    <div className="space-y-6">
      <MultiFormatSettingCard allowMultiFormatBatch={allowMultiFormatBatch} run={run} />

      {/* ── Tipos de separação (dimensões) ── */}
      <section>
        <SectionTitle
          aside={
            <Button size="sm" variant="outline" icon={<Plus aria-hidden className="size-3.5" />} onClick={() => setDialog({ kind: "dimension" })}>
              Novo tipo de separação
            </Button>
          }
        >
          Tipos de separação
        </SectionTitle>
        <p className="mb-3 text-xs text-ink-3">
          Marca, família, grupo e qualquer outra classificação que o gestor precisar. Cada uma tem valores próprios — todos podem ser adicionados, editados ou excluídos.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {dimensions.map((d) => (
            <SmallCard key={d.id} className={cn(!d.active && "bg-paper-deep/50")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-bold">
                    <Layers aria-hidden className="size-4 text-prod" />
                    {d.name}
                    {d.isBrand && <span className="rounded bg-hivis px-1.5 py-0.5 text-[10px] uppercase tracking-wide">essencial</span>}
                  </p>
                  <p className="text-xs text-ink-3">{d.values.length} valores cadastrados</p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconButton label={`Editar ${d.name}`} onClick={() => setDialog({ kind: "dimension-edit", dimension: d })} icon={<Pencil />} />
                  <IconButton
                    label={`Excluir ${d.name}`}
                    onClick={() =>
                      setDialog({
                        kind: "confirm",
                        title: `Excluir "${d.name}"?`,
                        body: "Todos os valores e as classificações dos produtos nesta separação serão removidos. Os produtos em si não são excluídos.",
                        confirmLabel: "Excluir separação",
                        danger: true,
                        action: () => api(`/api/admin/dimensions?id=${d.id}`, { method: "DELETE" }),
                        ok: `Separação ${d.name} excluída.`,
                      })
                    }
                    icon={<Trash2 />}
                  />
                </div>
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {d.values.length === 0 && <li className="text-xs text-ink-3">Nenhum valor ainda.</li>}
                {d.values.map((v) => (
                  <li key={v.id} className={cn("flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs font-semibold", v.active ? "border-line bg-white text-ink" : "border-dashed border-ink/25 bg-paper-deep text-ink-3 line-through")}>
                    <span>{v.name}</span>
                    <span className="tnum text-ink-3">({v.productCount})</span>
                    <button type="button" aria-label={`Editar ${v.name}`} onClick={() => setDialog({ kind: "value", dimensionId: d.id, value: v })} className="rounded p-0.5 hover:bg-ink/10">
                      <Pencil aria-hidden className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir ${v.name}`}
                      onClick={() =>
                        setDialog({
                          kind: "confirm",
                          title: `Excluir "${v.name}"?`,
                          body: "Valores em uso por produtos não podem ser excluídos. Troque a classificação dos produtos ou simplesmente desative o valor.",
                          confirmLabel: "Excluir valor",
                          danger: true,
                          action: () => api(`/api/admin/dimension-values?id=${v.id}`, { method: "DELETE" }),
                          ok: `${v.name} excluído(a).`,
                        })
                      }
                      className="rounded p-0.5 hover:bg-stop-soft hover:text-stop"
                    >
                      <Trash2 aria-hidden className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2">
                <Button size="sm" variant="ghost" icon={<Plus aria-hidden className="size-3.5" />} onClick={() => setDialog({ kind: "value", dimensionId: d.id })}>
                  Adicionar valor
                </Button>
                <Switch
                  checked={d.active}
                  label={`Separação ${d.name} ativa`}
                  onChange={(active) => void run(() => api("/api/admin/dimensions", { method: "PATCH", body: { id: d.id, active } }))}
                />
              </div>
            </SmallCard>
          ))}
        </div>
      </section>

      {/* ── Cadastro + filtros ── */}
      <SmallCard>
        <SectionTitle>Cadastrar produto</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {activeDimensions.map((d) => (
            <Field key={`filter-${d.id}`} label={`Filtrar por ${d.name}`} optional>
              <select className={inputCls} value={filters[d.id] ?? ""} onChange={(e) => setFilters((cur) => ({ ...cur, [d.id]: e.target.value }))}>
                <option value="">Todos</option>
                {d.values.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <Field label="Buscar" optional>
            <input className={inputCls} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Marca, formato…" />
          </Field>
          <Field label="Agrupar cards por">
            <select className={inputCls} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="brand">Marca</option>
              {activeDimensions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
              <option value="none">Nenhum</option>
            </select>
          </Field>
          <div className="flex items-end gap-2">
            <Button variant="hivis" icon={<Plus aria-hidden className="size-4" />} onClick={() => setDialog({ kind: "product" })}>
              Novo produto
            </Button>
            {(Object.values(filters).some(Boolean) || query) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setFilters({});
                  setQuery("");
                }}
              >
                Limpar
              </Button>
            )}
          </div>
        </div>
        <p className="mt-3 text-xs text-ink-3">
          {visible.length} de {products.length} produto(s) exibidos. Cada produto tem numeração própria de bateladas e suas embalagens de saída.
        </p>
      </SmallCard>

      {/* ── Seleção e alteração em massa ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink bg-ink px-3 py-2.5 text-paper">
        <ListChecks aria-hidden className="size-5 shrink-0 text-hivis" />
        <button
          type="button"
          onClick={() => setSelected(allVisibleSelected ? [] : visible.map((p) => p.id))}
          className="on-dark flex min-h-9 items-center gap-2 rounded-lg border border-paper/30 px-3 text-[13px] font-semibold transition hover:bg-paper/10"
        >
          <span aria-hidden className={cn("grid size-4 place-items-center rounded border", allVisibleSelected ? "border-hivis bg-hivis text-ink" : "border-paper/60")}>
            {allVisibleSelected && <Check aria-hidden className="size-3" strokeWidth={3} />}
          </span>
          {allVisibleSelected ? "Limpar seleção" : `Selecionar todos (${visible.length})`}
        </button>
        <span className="text-[13px] text-paper/80">
          <span className="tnum font-bold text-hivis">{selectedVisible.length}</span> selecionado(s)
        </span>
        <Button
          size="sm"
          variant="hivis"
          className="ml-auto"
          disabled={selectedVisible.length === 0}
          icon={<Pencil aria-hidden className="size-3.5" />}
          onClick={() => setDialog({ kind: "bulk" })}
        >
          Alterar em massa
        </Button>
        {selectedVisible.length > 0 && (
          <Button size="sm" variant="ghost" className="text-paper hover:bg-paper/10 hover:text-paper" onClick={() => setSelected([])}>
            Limpar
          </Button>
        )}
      </div>

      {/* ── Família → produtos e gramaturas ── */}
      {activeFilter && activeFilterValue && (
        <PanelCard>
          <SectionTitle aside={<span className="text-xs text-ink-3">{visible.length} produto(s) · {grammages.length} gramatura(s)</span>}>
            Produtos e gramaturas · {activeFilter.name}: {activeFilterValue}
          </SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {grammages.map((g) => (
              <span key={g} className="tnum rounded-lg border border-ink/25 bg-white px-2.5 py-1.5 text-sm font-semibold">{g}</span>
            ))}
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[480px] text-left text-[13px]">
              <thead className="bg-paper-deep/60 text-[11px] uppercase tracking-wide text-ink-3">
                <tr>
                  <th scope="col" className="px-3 py-2 font-bold">Marca</th>
                  <th scope="col" className="px-3 py-2 font-bold">Gramatura</th>
                  {activeDimensions.filter((d) => !d.isBrand).map((d) => (
                    <th key={d.id} scope="col" className="px-3 py-2 font-bold">{d.name}</th>
                  ))}
                  <th scope="col" className="px-3 py-2 font-bold">Próxima batelada</th>
                  <th scope="col" className="px-3 py-2 font-bold">Embalagens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-semibold">{p.brand}</td>
                    <td className="tnum px-3 py-2">{p.format}</td>
                    {activeDimensions.filter((d) => !d.isBrand).map((d) => (
                      <td key={d.id} className="px-3 py-2">{valueName(d.id, p.classifications[d.id] ?? null) ?? "—"}</td>
                    ))}
                    <td className="tnum px-3 py-2">#{p.nextNumber}</td>
                    <td className="px-3 py-2">{p.packaging.filter((o) => o.active).map((o) => packLabel(o.label, o.unitsPerBox)).join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelCard>
      )}

      {/* ── Produtos agrupados ── */}
      {groups.map(([title, items]) => (
        <section key={title}>
          <h2 className="display mb-2.5 text-[20px]">{title}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {items.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                dimensions={activeDimensions}
                valueName={valueName}
                run={run}
                selected={selected.includes(p.id)}
                onToggleSelected={() => toggleSelected(p.id)}
                onEdit={() => setDialog({ kind: "product", product: p })}
                onDelete={() =>
                  setDialog({
                    kind: "confirm",
                    title: `Excluir ${p.brand} ${p.format}?`,
                    body: "O produto sai do cadastro e não poderá mais ser usado em novas bateladas. O histórico e o saldo permanecem nos relatórios.",
                    confirmLabel: "Excluir produto",
                    danger: true,
                    action: () => api(`/api/admin/products?id=${p.id}`, { method: "DELETE" }),
                    ok: `${p.brand} ${p.format} excluído.`,
                  })
                }
              />
            ))}
          </div>
        </section>
      ))}
      {groups.length === 0 && <p className="rounded-xl border border-dashed border-ink/25 px-4 py-8 text-center text-sm text-ink-3">Nenhum produto corresponde aos filtros.</p>}

      {/* ── Diálogos ── */}
      {dialog?.kind === "dimension" && (
        <NameDialog
          title="Novo tipo de separação"
          label="Nome da separação"
          placeholder="Ex.: Linha, Segmento, Categoria"
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(name) => void submit(() => api("/api/admin/dimensions", { method: "POST", body: { name } }), `Separação "${name}" criada.`)}
        />
      )}
      {dialog?.kind === "dimension-edit" && (
        <NameDialog
          title={`Editar "${dialog.dimension.name}"`}
          label="Nome da separação"
          initial={dialog.dimension.name}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(name) =>
            void submit(() => api("/api/admin/dimensions", { method: "PATCH", body: { id: dialog.dimension.id, name } }), "Separação renomeada.")
          }
        />
      )}
      {dialog?.kind === "value" && (
        <ValueDialog
          dimension={dimensions.find((d) => d.id === dialog.dimensionId)!}
          value={dialog.value}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(name, active) => {
            const body = dialog.value ? { id: dialog.value.id, name, active } : { dimensionId: dialog.dimensionId, name };
            void submit(
              () => api("/api/admin/dimension-values", { method: dialog.value ? "PATCH" : "POST", body }),
              dialog.value ? `${name} atualizado(a).` : `${name} adicionado(a).`,
            );
          }}
        />
      )}
      {dialog?.kind === "product" && (
        <ProductFormDialog
          product={dialog.product}
          dimensions={activeDimensions}
          brandDimension={brandDim}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(body) =>
            void submit(
              () => api("/api/admin/products", { method: dialog.product ? "PATCH" : "POST", body }),
              dialog.product ? "Produto atualizado." : "Produto cadastrado. Agora vincule as embalagens de saída.",
            )
          }
        />
      )}
      {dialog?.kind === "bulk" && (
        <BulkDialog
          count={selectedVisible.length}
          dimensions={activeDimensions}
          busy={busy}
          error={dialogError}
          onClose={() => setDialog(null)}
          onSubmit={(classifications) =>
            void submit(
              () => api("/api/admin/products/bulk", { method: "POST", body: { ids: selectedVisible, classifications } }),
              `${selectedVisible.length} produto(s) atualizado(s) em massa.`,
            ).then(() => setSelected([]))
          }
        />
      )}
      {dialog?.kind === "confirm" && (
        <Modal
          eyebrow="Confirmar exclusão"
          title={dialog.title}
          onClose={() => setDialog(null)}
          width="max-w-lg"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>
                Cancelar
              </Button>
              <Button variant="danger" loading={busy} onClick={() => void submit(dialog.action, dialog.ok)}>
                {dialog.confirmLabel}
              </Button>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-2">{dialog.body}</p>
          <ErrorNote>{dialogError}</ErrorNote>
        </Modal>
      )}
    </div>
  );
}

function IconButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="grid size-9 place-items-center rounded-lg text-ink-3 transition hover:bg-ink/8 hover:text-ink [&>svg]:size-4">
      {icon}
    </button>
  );
}

/* ───────────── Card do produto ───────────── */

function ProductCard({
  product,
  dimensions,
  valueName,
  run,
  selected,
  onToggleSelected,
  onEdit,
  onDelete,
}: {
  product: ProductDTO;
  dimensions: DimensionDTO[];
  valueName: (dimensionId: number, valueId: number | null) => string | null;
  run: Run;
  selected: boolean;
  onToggleSelected: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [type, setType] = useState(PACK_TYPES[0]);
  const [units, setUnits] = useState("");
  const [busy, setBusy] = useState(false);
  const title = `${product.brand} ${product.format}`;

  async function addPackaging(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await run(
      () => api("/api/admin/packaging", { method: "POST", body: { productId: product.id, label: type, unitsPerBox: Number(units) } }),
      `${packLabel(type, Number(units))} vinculada a ${title}.`,
    );
    setBusy(false);
    if (ok) setUnits("");
  }

  return (
    <PanelCard className={cn(!product.active && "bg-paper-deep/50", selected && "border-ink ring-2 ring-hivis")}>
      <div className="flex items-start justify-between gap-3">
        <label className="-mt-0.5 flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-ink/20 bg-white px-2 py-1.5 text-xs font-semibold">
          <input type="checkbox" className="size-4 accent-ink" checked={selected} onChange={onToggleSelected} aria-label={`Selecionar ${title}`} />
          Sel.
        </label>
        <div className="min-w-0 flex-1">
          <ProductTag brand={product.brand} format={product.format} size="md" />
          <p className="mt-1.5 text-xs text-ink-3">
            {product.description ? `${product.description} · ` : ""}próxima batelada <span className="tnum font-bold text-ink-2">#{product.nextNumber}</span>
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {dimensions
              .filter((d) => !d.isBrand)
              .map((d) => {
                const value = valueName(d.id, product.classifications[d.id] ?? null);
                return (
                  <li key={d.id} className="rounded bg-paper-deep px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
                    {d.name}: {value ?? "—"}
                  </li>
                );
              })}
          </ul>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label={`Editar ${title}`} onClick={onEdit} icon={<Pencil />} />
          <IconButton label={`Excluir ${title}`} onClick={onDelete} icon={<Trash2 />} />
        </div>
      </div>
      <div className="mt-2 flex justify-end">
        <Switch
          checked={product.active}
          label={`Produto ${title} ativo`}
          onChange={(active) =>
            void run(
              () => api("/api/admin/products", { method: "PATCH", body: { id: product.id, active } }),
              active ? `${title} reativado.` : `${title} desativado: não aparece mais para novas bateladas.`,
            )
          }
        />
      </div>

      <h3 className="mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Embalagens de saída</h3>
      {product.packaging.length === 0 ? (
        <p className="rounded-lg bg-prod-soft px-3 py-2 text-[13px] text-prod">Nenhuma embalagem vinculada. O acabamento não conseguirá finalizar bateladas deste produto.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {product.packaging.map((o) => {
            const name = packLabel(o.label, o.unitsPerBox);
            return (
              <li key={o.id} className="flex items-center gap-2 py-1 pl-3 pr-1">
                <span className={cn("min-w-0 flex-1 truncate text-sm font-semibold", !o.active && "text-ink-3 line-through")}>{name}</span>
                <Switch checked={o.active} label={`Embalagem ${name} de ${title} ativa`} onChange={(active) => void run(() => api("/api/admin/packaging", { method: "PATCH", body: { id: o.id, active } }))} />
                <IconButton
                  label={`Excluir embalagem ${name}`}
                  icon={<Trash2 />}
                  onClick={() =>
                    void run(() => api(`/api/admin/packaging?id=${o.id}`, { method: "DELETE" }), `${name} removida de ${title}.`)
                  }
                />
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={addPackaging} className="mt-2.5 flex items-center gap-2">
        <div className="w-28 shrink-0">
          <select className={inputCls} aria-label={`Tipo de embalagem para ${title}`} value={type} onChange={(e) => setType(e.target.value)}>
            {PACK_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-ink-3">c/</span>
        <input
          className={cn(inputCls, "tnum max-w-20 text-center font-bold")}
          aria-label={`Unidades por embalagem para ${title}`}
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="12"
          value={units}
          onChange={(e) => setUnits(e.target.value.replace(/\D/g, "").slice(0, 4))}
        />
        <span className="text-sm text-ink-3">un</span>
        <Button type="submit" variant="outline" className="ml-auto" loading={busy} disabled={!units || Number(units) < 1}>
          Vincular
        </Button>
      </form>
    </PanelCard>
  );
}

/* ───────────── Diálogos de nome ───────────── */

function NameDialog({
  title,
  label,
  placeholder,
  initial = "",
  busy,
  error,
  onClose,
  onSubmit,
}: {
  title: string;
  label: string;
  placeholder?: string;
  initial?: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <Modal
      eyebrow="Admin · classificações"
      title={title}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="name-form" loading={busy} disabled={!name.trim()}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="name-form" onSubmit={(e) => { e.preventDefault(); onSubmit(name.trim()); }} className="space-y-3">
        <Field label={label}>
          <input className={inputCls} autoFocus value={name} maxLength={40} placeholder={placeholder} onChange={(e) => setName(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}

function ValueDialog({
  dimension,
  value,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  dimension: DimensionDTO;
  value?: DimensionValueDTO;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string, active: boolean) => void;
}) {
  const [name, setName] = useState(value?.name ?? "");
  const [active, setActive] = useState(value?.active ?? true);
  return (
    <Modal
      eyebrow={`${dimension.name} · valores`}
      title={value ? "Editar valor" : "Adicionar valor"}
      onClose={onClose}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="value-form" loading={busy} disabled={!name.trim()}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="value-form" onSubmit={(e) => { e.preventDefault(); onSubmit(name.trim(), active); }} className="space-y-3">
        <Field label={`Nome do valor de ${dimension.name}`} hint={dimension.isBrand ? "Renomear uma marca atualiza também as bateladas já registradas." : undefined}>
          <input className={inputCls} autoFocus value={name} maxLength={40} placeholder="Ex.: Alho triturado" onChange={(e) => setName(e.target.value)} />
        </Field>
        {value && dimension.isBrand && (
          <p className="rounded-lg bg-prod-soft px-3 py-2 text-xs text-prod">
            Este valor está em {value.productCount} produto(s). Ao renomear, a etiqueta e o histórico serão atualizados.
          </p>
        )}
        {value && <Switch checked={active} label="Valor ativo" onChange={setActive} />}
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}

function ProductFormDialog({
  product,
  dimensions,
  brandDimension,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  product?: ProductDTO;
  dimensions: DimensionDTO[];
  brandDimension?: DimensionDTO;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [format, setFormat] = useState(product?.format ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [selected, setSelected] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {};
    for (const d of dimensions) {
      const valueId = product?.classifications[d.id];
      // Só a Marca ganha um palpite no cadastro; as demais ficam "Sem classificação".
      init[d.id] = valueId
        ? String(valueId)
        : !product && d.isBrand && d.values[0]
          ? String(d.values[0].id)
          : "";
    }
    return init;
  });
  const [newBrand, setNewBrand] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const classifications = dimensions
      .filter((d) => selected[d.id])
      .map((d) => ({ dimensionId: d.id, valueId: Number(selected[d.id]) }));
    const brand = newBrand.trim() || (brandDimension ? brandDimension.values.find((v) => String(v.id) === selected[brandDimension.id])?.name : undefined);
    if (!brand) return;
    onSubmit({
      ...(product ? { id: product.id } : {}),
      brand,
      format,
      description,
      classifications,
    });
  }

  return (
    <Modal
      eyebrow="Admin · produtos"
      title={product ? `Editar ${product.brand} ${product.format}` : "Novo produto"}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="product-form" loading={busy} disabled={!format.trim()}>
            {product ? "Salvar alterações" : "Cadastrar"}
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {dimensions.map((d) => (
            <Field
              key={d.id}
              label={d.name}
              optional={!d.isBrand}
              hint={d.slug === "familia" ? "Exibida como filtro obrigatório ao abrir batelada." : undefined}
            >
              <select className={inputCls} value={selected[d.id] ?? ""} onChange={(e) => setSelected((cur) => ({ ...cur, [d.id]: e.target.value }))}>
                <option value="">Sem classificação</option>
                {d.values.filter((v) => v.active).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <Field label="Gramatura / formato">
            <input className={inputCls} value={format} maxLength={20} placeholder="450 g" onChange={(e) => setFormat(e.target.value)} />
          </Field>
          <Field label="Descrição" optional>
            <input className={inputCls} value={description} maxLength={120} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        {brandDimension && (
          <div className="rounded-lg border border-dashed border-ink/30 bg-white p-3">
            <p className="text-xs font-semibold text-ink-2">Marca ainda não cadastrada? Digite o nome para criar agora:</p>
            <div className="mt-2 flex gap-2">
              <input className={inputCls} value={newBrand} maxLength={40} placeholder="Ex.: Nova Marca" onChange={(e) => setNewBrand(e.target.value)} />
              <span className="flex items-center text-xs text-ink-3">ou use a lista acima</span>
            </div>
          </div>
        )}
        <p className="text-xs text-ink-3">
          Depois de cadastrar, vincule as embalagens de saída no card do produto. A numeração de bateladas é por produto (marca + formato).
        </p>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}

/* ───────────── Alteração em massa ───────────── */

function BulkDialog({
  count,
  dimensions,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  count: number;
  dimensions: DimensionDTO[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (classifications: Array<{ dimensionId: number; valueId: number | null }>) => void;
}) {
  const [choices, setChoices] = useState<Record<number, string>>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const classifications = Object.entries(choices)
      .filter(([, value]) => value !== "")
      .map(([dimensionId, value]) => ({
        dimensionId: Number(dimensionId),
        valueId: value === "none" ? null : Number(value),
      }));
    if (classifications.length === 0) return;
    onSubmit(classifications);
  }

  return (
    <Modal
      eyebrow="Admin · alteração em massa"
      title={`Alterar ${count} produto(s)`}
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="bulk-form" loading={busy} disabled={!Object.values(choices).some((v) => v !== "")}>
            Aplicar a {count} produto(s)
          </Button>
        </>
      }
    >
      <form id="bulk-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm leading-relaxed text-ink-2">
          Escolha o novo valor para marca, família, grupo ou qualquer outra separação. Deixe <strong>Manter como está</strong> nas
          classificações que não devem mudar. Trocar a marca atualiza também as bateladas antigas desses produtos.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {dimensions.map((d) => (
            <Field key={d.id} label={d.name}>
              <select
                className={inputCls}
                value={choices[d.id] ?? ""}
                onChange={(e) => setChoices((cur) => ({ ...cur, [d.id]: e.target.value }))}
              >
                <option value="">Manter como está</option>
                {d.values.filter((v) => v.active).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
                {!d.isBrand && <option value="none">Remover classificação</option>}
              </select>
            </Field>
          ))}
        </div>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}
