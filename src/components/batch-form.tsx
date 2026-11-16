"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Check, Clock } from "lucide-react";
import {
  findFamilyDimension,
  missingForReady,
  PROCESS_STEPS,
  timeOrderErrors,
  type BatchDTO,
  type DimensionDTO,
  type ProductDTO,
  type ProductionData,
} from "@/lib/domain";
import { api, errMsg, fmtDuration, fmtInt, fromLocalInput, toLocalInput } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal, ProductTag, SectionTitle } from "@/components/ui";

type TimeKey = "mixStart" | "mixEnd" | "fillStart" | "fillEnd" | "finishStart" | "finishEnd";

interface FormState extends Record<TimeKey, string> {
  garlicLot: string;
  preservativeLot: string;
  goodUnits: string;
  lossUnits: string;
  notes: string;
}

type FamilyChoiceKey = number | "none";

const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 7);
const toInt = (v: string) => (v.trim() === "" ? null : Number(v));

/** Etapa 1: abertura e preenchimento da batelada pelo operador de produção. */
export function BatchForm({
  batch,
  products,
  dimensions = [],
  allowMultiFormatBatch = true,
  onClose,
  onDone,
}: {
  batch?: BatchDTO;
  products: ProductDTO[];
  dimensions?: DimensionDTO[];
  allowMultiFormatBatch?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = !!batch;
  const brands = useMemo(() => [...new Set(products.map((p) => p.brand))], [products]);
  const familyDim = useMemo(() => findFamilyDimension(dimensions), [dimensions]);
  const activeFamilyValues = useMemo(
    () => (familyDim?.active ? familyDim.values.filter((v) => v.active) : []),
    [familyDim],
  );
  const requireFamily = !!familyDim?.active && activeFamilyValues.length > 0;

  const [brand, setBrand] = useState(batch?.brand ?? "");
  const [familyKey, setFamilyKey] = useState<FamilyChoiceKey | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => (batch ? batch.productIds : []));
  const [f, setF] = useState<FormState>(() => ({
    garlicLot: batch?.garlicLot ?? "",
    preservativeLot: batch?.preservativeLot ?? "",
    mixStart: toLocalInput(batch?.mixStart ?? null),
    mixEnd: toLocalInput(batch?.mixEnd ?? null),
    fillStart: toLocalInput(batch?.fillStart ?? null),
    fillEnd: toLocalInput(batch?.fillEnd ?? null),
    finishStart: toLocalInput(batch?.finishStart ?? null),
    finishEnd: toLocalInput(batch?.finishEnd ?? null),
    goodUnits: batch?.goodUnits?.toString() ?? "",
    lossUnits: batch?.lossUnits?.toString() ?? "",
    notes: batch?.notes ?? "",
  }));
  const [busy, setBusy] = useState<"save" | "ready" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setF((cur) => ({ ...cur, [key]: value }));

  const brandProducts = useMemo(() => products.filter((p) => p.brand === brand), [products, brand]);

  const familyOptions = useMemo(() => {
    if (!brand || !familyDim?.active) return [];
    const activeIds = new Set(activeFamilyValues.map((v) => v.id));
    const options: Array<{ key: FamilyChoiceKey; label: string; count: number }> = activeFamilyValues.map((v) => ({
      key: v.id,
      label: v.name,
      count: brandProducts.filter((p) => p.classifications[familyDim.id] === v.id).length,
    }));
    options.sort((a, b) => Number(b.count > 0) - Number(a.count > 0));
    const uncategorizedCount = brandProducts.filter((p) => {
      const valId = p.classifications[familyDim.id];
      return !valId || !activeIds.has(valId);
    }).length;
    if (uncategorizedCount > 0) {
      options.push({ key: "none", label: "Sem família", count: uncategorizedCount });
    }
    return options;
  }, [brand, familyDim, activeFamilyValues, brandProducts]);

  const availableProducts = useMemo(() => {
    if (!brand) return [];
    if (!requireFamily || !familyDim) return brandProducts;
    if (familyKey === null) return [];
    if (familyKey === "none") {
      const activeIds = new Set(activeFamilyValues.map((v) => v.id));
      return brandProducts.filter((p) => {
        const valId = p.classifications[familyDim.id];
        return !valId || !activeIds.has(valId);
      });
    }
    return brandProducts.filter((p) => p.classifications[familyDim.id] === familyKey);
  }, [brand, brandProducts, requireFamily, familyDim, familyKey, activeFamilyValues]);

  // Mantém a ordem por peso (a mesma usada pelo servidor para definir a batelada principal).
  const orderedSelected = useMemo(
    () => availableProducts.filter((p) => selectedIds.includes(p.id)),
    [availableProducts, selectedIds],
  );
  const primaryProduct = orderedSelected[0] ?? null;
  const selectedFamilyLabel =
    familyKey === null ? null : familyOptions.find((o) => o.key === familyKey)?.label ?? null;

  function toggleProduct(id: number) {
    if (!allowMultiFormatBatch) {
      setSelectedIds([id]);
      return;
    }
    setSelectedIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function selectAllFormats() {
    if (!allowMultiFormatBatch) return;
    if (orderedSelected.length === availableProducts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(availableProducts.map((p) => p.id));
    }
  }

  const data: ProductionData & { notes: string } = {
    garlicLot: f.garlicLot.trim() || null,
    preservativeLot: f.preservativeLot.trim() || null,
    mixStart: fromLocalInput(f.mixStart),
    mixEnd: fromLocalInput(f.mixEnd),
    fillStart: fromLocalInput(f.fillStart),
    fillEnd: fromLocalInput(f.fillEnd),
    finishStart: fromLocalInput(f.finishStart),
    finishEnd: fromLocalInput(f.finishEnd),
    goodUnits: toInt(f.goodUnits),
    lossUnits: toInt(f.lossUnits),
    notes: f.notes,
  };
  const orderErrors = timeOrderErrors(data);
  const missing = missingForReady(data);
  const hasProduct = editing || orderedSelected.length > 0;
  const canSave = hasProduct && orderErrors.length === 0;
  const canReady = canSave && missing.length === 0;

  const good = data.goodUnits ?? 0;
  const loss = data.lossUnits ?? 0;
  const yieldPct = good + loss > 0 ? (good / (good + loss)) * 100 : null;

  const stepPrompt = !brand
    ? "1. Escolha a marca"
    : requireFamily && familyKey === null
      ? "2. Escolha a família"
      : orderedSelected.length === 0
        ? allowMultiFormatBatch
          ? "3. Marque uma ou mais gramaturas"
          : "3. Marque uma gramatura"
        : "Sequencial gerado ao salvar";

  async function submit(markReady: boolean) {
    if (!canSave || (markReady && !canReady)) return;
    setBusy(markReady ? "ready" : "save");
    setError(null);
    try {
      if (batch) {
        await api(`/api/batches/${batch.id}`, { method: "PATCH", body: { ...data, markReady } });
        onDone(markReady ? `Batelada #${batch.number} enviada à Qualidade.` : `Batelada #${batch.number} salva.`);
      } else {
        const created = await api<{ number: number }>("/api/batches", {
          method: "POST",
          body: { ...data, productIds: orderedSelected.map((p) => p.id), markReady },
        });
        onDone(
          markReady
            ? `Batelada #${created.number} criada e enviada à Qualidade.`
            : `Batelada #${created.number} criada em "Em preparo".`,
        );
      }
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit(false);
  }

  return (
    <Modal
      eyebrow="Produção"
      title={batch ? `Batelada #${batch.number}` : "Nova batelada"}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy !== null} className="mr-auto">
            Cancelar
          </Button>
          <Button type="submit" form="batch-form" variant="outline" loading={busy === "save"} disabled={!canSave || busy !== null}>
            Salvar em preparo
          </Button>
          <Button loading={busy === "ready"} disabled={!canReady || busy !== null} onClick={() => void submit(true)}>
            Salvar e marcar Pronto
          </Button>
        </>
      }
    >
      <form id="batch-form" onSubmit={onSubmit} className="space-y-6">
        {/* Identificação */}
        <section>
          <SectionTitle>Produto</SectionTitle>
          {batch ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card px-3 py-2.5">
              <span className="display tnum text-[30px]">#{batch.number}</span>
              <ProductTag brand={batch.brand} format={batch.format} size="md" />
              {batch.familyName && (
                <span className="rounded bg-paper-deep px-2 py-0.5 text-xs font-semibold text-ink-2">{batch.familyName}</span>
              )}
              <span className="text-xs text-ink-3">Número e produto não mudam depois de criada.</span>
            </div>
          ) : products.length === 0 ? (
            <ErrorNote>Nenhum produto ativo cadastrado. Peça ao gestor para cadastrar em Admin › Produtos e embalagens.</ErrorNote>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="space-y-4">
                <div>
                  <span className="mb-1.5 block text-[13px] font-semibold">1 · Marca</span>
                  <div className="flex flex-wrap gap-2">
                    {brands.map((b) => (
                      <button
                        key={b}
                        type="button"
                        aria-pressed={b === brand}
                        onClick={() => {
                          setBrand(b);
                          setFamilyKey(null);
                          setSelectedIds([]);
                        }}
                        className={cn(
                          "h-11 min-w-20 rounded-lg border-2 px-4 text-sm font-bold uppercase tracking-wide transition",
                          b === brand ? "border-ink bg-ink text-hivis" : "border-ink/25 bg-white text-ink hover:border-ink",
                        )}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>

                {brand && requireFamily && (
                  <div>
                    <span className="mb-1.5 block text-[13px] font-semibold">2 · Família</span>
                    <div className="flex flex-wrap gap-2">
                      {familyOptions.map((opt) => {
                        const active = familyKey === opt.key;
                        return (
                          <button
                            key={String(opt.key)}
                            type="button"
                            aria-pressed={active}
                            onClick={() => {
                              setFamilyKey(opt.key);
                              setSelectedIds([]);
                            }}
                            className={cn(
                              "flex h-11 items-center gap-2 rounded-lg border-2 px-3.5 text-sm font-bold transition",
                              active
                                ? "border-ink bg-ink text-paper"
                                : opt.count === 0
                                  ? "border-dashed border-ink/25 bg-paper-deep/50 text-ink-2 hover:border-ink"
                                  : "border-ink/25 bg-white text-ink hover:border-ink",
                            )}
                          >
                            <span>{opt.label}</span>
                            <span
                              className={cn(
                                "tnum rounded px-1.5 py-0.5 text-[11px] font-bold leading-none",
                                active ? "bg-paper/20 text-paper" : "bg-ink/8 text-ink-3",
                              )}
                            >
                              {opt.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {brand && (!requireFamily || familyKey !== null) && (
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold">
                        {requireFamily ? "3 · " : "2 · "}
                        {allowMultiFormatBatch ? "Gramaturas" : "Gramatura"}
                        <span className="ml-2 text-xs font-normal text-ink-3">
                          {allowMultiFormatBatch
                            ? orderedSelected.length > 0
                              ? `${orderedSelected.length} selecionada(s)`
                              : "Pode marcar uma ou várias"
                            : "Seleção única"}
                        </span>
                      </span>
                      {allowMultiFormatBatch && availableProducts.length > 1 && (
                        <button
                          type="button"
                          onClick={selectAllFormats}
                          className="text-xs font-bold text-ink underline underline-offset-2 hover:text-ink-2"
                        >
                          {orderedSelected.length === availableProducts.length ? "Limpar seleção" : "Marcar todas"}
                        </button>
                      )}
                    </div>
                    {availableProducts.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-ink/25 bg-paper-deep/40 px-3 py-3 text-xs text-ink-2">
                        Nenhuma gramatura ativa cadastrada para{" "}
                        <strong>
                          {brand}
                          {selectedFamilyLabel ? ` · ${selectedFamilyLabel}` : ""}
                        </strong>
                        . Cadastre ou classifique os produtos em Admin › Produtos e classificações.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {availableProducts.map((p) => {
                          const checked = selectedIds.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              aria-pressed={checked}
                              onClick={() => toggleProduct(p.id)}
                              className={cn(
                                "tnum flex h-11 items-center gap-2 rounded-lg border-2 px-3.5 text-sm font-bold transition",
                                checked ? "border-ink bg-ink text-paper" : "border-ink/25 bg-white text-ink hover:border-ink",
                              )}
                            >
                              {allowMultiFormatBatch && (
                                <span
                                  aria-hidden
                                  className={cn(
                                    "grid size-4 place-items-center rounded border-2",
                                    checked ? "border-hivis bg-hivis text-ink" : "border-ink/35 bg-white",
                                  )}
                                >
                                  {checked && <Check className="size-3" strokeWidth={3} />}
                                </span>
                              )}
                              {p.format}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex min-w-40 max-w-52 flex-col justify-center rounded-lg border border-dashed border-ink/35 bg-card px-4 py-3 sm:text-center">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">Nº da batelada</span>
                <span className={cn("display tnum mt-1 text-[44px]", !primaryProduct && "text-ink/25")}>
                  #{primaryProduct ? primaryProduct.nextNumber : "—"}
                </span>
                {orderedSelected.length > 0 && (
                  <span className="tnum mt-1 text-xs font-bold text-ink">
                    {brand}
                    {selectedFamilyLabel && selectedFamilyLabel !== "Sem família" ? ` · ${selectedFamilyLabel}` : ""}
                    <span className="block font-semibold text-ink-2">{orderedSelected.map((p) => p.format).join(" + ")}</span>
                  </span>
                )}
                <span className="mt-1 text-[11px] leading-tight text-ink-3">{stepPrompt}</span>
              </div>
            </div>
          )}
        </section>

        {/* Insumos */}
        <section>
          <SectionTitle>Lotes de insumos</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Lote do alho">
              <input
                className={cn(inputCls, "font-mono uppercase")}
                value={f.garlicLot}
                maxLength={60}
                autoCapitalize="characters"
                onChange={(e) => set("garlicLot", e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Lote do conservante">
              <input
                className={cn(inputCls, "font-mono uppercase")}
                value={f.preservativeLot}
                maxLength={60}
                autoCapitalize="characters"
                onChange={(e) => set("preservativeLot", e.target.value.toUpperCase())}
              />
            </Field>
          </div>
        </section>

        {/* Tempos */}
        <section>
          <SectionTitle>Horários de processo</SectionTitle>
          <div className="space-y-2.5">
            {PROCESS_STEPS.map((step) => {
              const start = data[step.start] as string | null;
              const end = data[step.end] as string | null;
              const invalid = !!start && !!end && new Date(end).getTime() < new Date(start).getTime();
              return (
                <fieldset key={step.key} className={cn("rounded-lg border bg-card p-3", invalid ? "border-stop" : "border-line")}>
                  <legend className="sr-only">{step.label}</legend>
                  <div aria-hidden className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold">{step.label}</span>
                    <span className={cn("tnum text-xs", invalid ? "font-semibold text-stop" : "text-ink-3")}>
                      {invalid ? "Fim anterior ao início" : start && end ? `Duração: ${fmtDuration(start, end)}` : ""}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {([["Início", step.start], ["Fim", step.end]] as const).map(([label, key]) => (
                      <div key={key}>
                        <label htmlFor={`t-${key}`} className="mb-1 block text-xs font-semibold text-ink-2">
                          {label}
                          <span className="sr-only"> de {step.label.toLowerCase()}</span>
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            id={`t-${key}`}
                            type="datetime-local"
                            className={cn(inputCls, "tnum px-2")}
                            value={f[key]}
                            onChange={(e) => set(key, e.target.value)}
                          />
                          <button
                            type="button"
                            onClick={() => set(key, toLocalInput(new Date().toISOString()))}
                            className="flex h-11 shrink-0 items-center gap-1 rounded-lg border border-ink/25 bg-white px-2.5 text-xs font-bold text-ink transition hover:border-ink"
                            aria-label={`Usar a hora atual em ${label.toLowerCase()} de ${step.label.toLowerCase()}`}
                          >
                            <Clock aria-hidden className="size-3.5" />
                            Agora
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </section>

        {/* Resultado */}
        <section>
          <SectionTitle
            aside={
              yieldPct !== null && (
                <span className="tnum text-xs text-ink-3">
                  Rendimento: <span className="font-bold text-ink">{yieldPct.toFixed(1).replace(".", ",")}%</span> de {fmtInt(good + loss)}
                </span>
              )
            }
          >
            Resultado
          </SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Unidades boas">
              <input
                className={cn(inputCls, "tnum font-bold")}
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.goodUnits}
                onChange={(e) => set("goodUnits", onlyDigits(e.target.value))}
              />
            </Field>
            <Field label="Perdas (unidades)">
              <input
                className={cn(inputCls, "tnum font-bold")}
                inputMode="numeric"
                pattern="[0-9]*"
                value={f.lossUnits}
                onChange={(e) => set("lossUnits", onlyDigits(e.target.value))}
              />
            </Field>
          </div>
          <Field label="Observações" optional className="mt-4">
            <textarea
              className={cn(inputCls, "h-20 resize-none py-2.5")}
              value={f.notes}
              maxLength={1000}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
        </section>

        {hasProduct && missing.length > 0 && (
          <p className="rounded-lg bg-prod-soft px-3 py-2.5 text-sm text-prod">
            <span className="font-bold">Pode salvar agora e completar depois.</span> Para marcar Pronto ainda falta:{" "}
            {missing.join(", ").toLowerCase()}.
          </p>
        )}
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}
