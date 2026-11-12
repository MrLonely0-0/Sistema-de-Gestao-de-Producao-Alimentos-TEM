"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Clock } from "lucide-react";
import {
  missingForReady,
  PROCESS_STEPS,
  timeOrderErrors,
  type BatchDTO,
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

const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 7);
const toInt = (v: string) => (v.trim() === "" ? null : Number(v));

/** Etapa 1: abertura e preenchimento da batelada pelo operador de produção. */
export function BatchForm({
  batch,
  products,
  onClose,
  onDone,
}: {
  batch?: BatchDTO;
  products: ProductDTO[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const editing = !!batch;
  const brands = useMemo(() => [...new Set(products.map((p) => p.brand))], [products]);
  const [brand, setBrand] = useState(batch?.brand ?? brands[0] ?? "");
  const [productId, setProductId] = useState<number | null>(batch?.productId ?? null);
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
  const product = products.find((p) => p.id === productId);
  const formats = products.filter((p) => p.brand === brand);

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
  const hasProduct = editing || productId !== null;
  const canSave = hasProduct && orderErrors.length === 0;
  const canReady = canSave && missing.length === 0;

  const good = data.goodUnits ?? 0;
  const loss = data.lossUnits ?? 0;
  const yieldPct = good + loss > 0 ? (good / (good + loss)) * 100 : null;

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
          body: { ...data, productId, markReady },
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
              <span className="text-xs text-ink-3">Número e produto não mudam depois de criada.</span>
            </div>
          ) : products.length === 0 ? (
            <ErrorNote>Nenhum produto ativo cadastrado. Peça ao gestor para cadastrar em Admin › Produtos e embalagens.</ErrorNote>
          ) : (
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                <div>
                  <span className="mb-1.5 block text-[13px] font-semibold">Marca</span>
                  <div className="flex flex-wrap gap-2">
                    {brands.map((b) => (
                      <button
                        key={b}
                        type="button"
                        aria-pressed={b === brand}
                        onClick={() => {
                          setBrand(b);
                          setProductId(null);
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
                <div>
                  <span className="mb-1.5 block text-[13px] font-semibold">Formato</span>
                  <div className="flex flex-wrap gap-2">
                    {formats.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={p.id === productId}
                        onClick={() => setProductId(p.id)}
                        className={cn(
                          "tnum h-11 rounded-lg border-2 px-3.5 text-sm font-bold transition",
                          p.id === productId ? "border-ink bg-ink text-paper" : "border-ink/25 bg-white text-ink hover:border-ink",
                        )}
                      >
                        {p.format}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex min-w-36 flex-col justify-center rounded-lg border border-dashed border-ink/35 bg-card px-4 py-3 sm:text-center">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink-3">Nº da batelada</span>
                <span className={cn("display tnum mt-1 text-[44px]", !product && "text-ink/25")}>
                  #{product ? product.nextNumber : "—"}
                </span>
                <span className="mt-1 text-[11px] leading-tight text-ink-3">
                  {product ? "Sequencial deste item, gerado ao salvar" : "Escolha marca e formato"}
                </span>
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
