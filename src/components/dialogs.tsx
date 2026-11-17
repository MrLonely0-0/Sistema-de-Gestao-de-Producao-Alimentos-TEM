"use client";

import { useState, type FormEvent } from "react";
import { Check, Clock, Minus, Plus, ShieldCheck } from "lucide-react";
import { finishOrderError, missingForFinish, type BatchDTO, type ProductDTO, type StockRowDTO } from "@/lib/domain";
import { api, errMsg, fmtDuration, fmtInt, fromLocalInput, packLabel, toLocalInput } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal, ProductTag, SectionTitle } from "@/components/ui";

const onlyDigits = (v: string) => v.replace(/\D/g, "").slice(0, 7);

function BatchHeadline({ batch }: { batch: BatchDTO }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card px-3 py-2.5">
      <span className="display tnum text-[30px]">#{batch.number}</span>
      <ProductTag brand={batch.brand} format={batch.format} size="md" />
      {batch.familyName && (
        <span className="rounded bg-paper-deep px-2 py-0.5 text-xs font-semibold text-ink-2">{batch.familyName}</span>
      )}
      {batch.goodUnits !== null && (
        <span className="ml-auto text-sm text-ink-2">
          <span className="tnum font-bold text-ink">{fmtInt(batch.goodUnits)}</span> unidades boas
        </span>
      )}
    </div>
  );
}

/** Campo numérico com botões grandes de − e +, pensado para tablet no chão de fábrica. */
function Stepper({
  value,
  onChange,
  label,
  max,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  max?: number;
}) {
  const n = parseInt(value, 10) || 0;
  const bump = (delta: number) => {
    const next = Math.max(0, n + delta);
    onChange(String(max !== undefined ? Math.min(max, next) : next));
  };
  const btn = "grid size-11 shrink-0 place-items-center text-ink transition hover:bg-ink/8 disabled:opacity-35";
  return (
    <div className="flex h-11 items-stretch overflow-hidden rounded-lg border border-ink/25 bg-white focus-within:border-ink focus-within:ring-2 focus-within:ring-hivis">
      <button type="button" className={btn} onClick={() => bump(-1)} disabled={n <= 0} aria-label={`Diminuir ${label}`}>
        <Minus aria-hidden className="size-4" />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        placeholder="0"
        onChange={(e) => onChange(onlyDigits(e.target.value))}
        className="tnum w-full min-w-0 border-x border-ink/15 bg-transparent text-center text-base font-bold outline-none"
      />
      <button
        type="button"
        className={btn}
        onClick={() => bump(1)}
        disabled={max !== undefined && n >= max}
        aria-label={`Aumentar ${label}`}
      >
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  );
}

function ReadOnlyNotice() {
  return (
    <p className="rounded-lg border border-qual/30 bg-qual-soft px-3 py-2 text-xs font-medium text-qual">
      Modo visualização (somente leitura): você pode testar os campos para demonstração, mas não é possível salvar ou confirmar.
    </p>
  );
}

/* ───────────── Etapa 2 · Liberar ───────────── */

export function ReleaseDialog({
  batch,
  readOnly = false,
  onClose,
  onDone,
}: {
  batch: BatchDTO;
  readOnly?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (readOnly) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/batches/${batch.id}/transition`, { method: "POST", body: { action: "liberar" } });
      onDone(`Lote #${batch.number} liberado. Carimbo registrado.`);
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      eyebrow="Qualidade"
      title="Liberar este lote?"
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="ok" loading={busy} disabled={readOnly} onClick={confirm} icon={<ShieldCheck aria-hidden className="size-4" />}>
            Liberar e carimbar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {readOnly && <ReadOnlyNotice />}
        <BatchHeadline batch={batch} />
        <p className="text-sm leading-relaxed text-ink-2">
          Ao confirmar, o sistema grava a <strong className="text-ink">data e a hora exatas</strong> da liberação, com o
          seu nome. Esse carimbo é <strong className="text-ink">definitivo</strong>: não pode ser editado nem desfeito, e
          o lote segue para o Acabamento.
        </p>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

/* ───────────── Etapa 2 · Reter / Devolver (pedem motivo) ───────────── */

const REASON_COPY = {
  reter: {
    title: "Reter lote",
    label: "Motivo da retenção",
    help: "O lote fica na coluna Qualidade como Retido até ser liberado ou devolvido.",
    placeholder: "Ex.: pH acima do limite, aguardando reanálise",
    confirm: "Reter lote",
    done: (n: number) => `Lote #${n} retido.`,
  },
  devolver: {
    title: "Devolver à Produção",
    label: "Motivo da devolução",
    help: "A batelada volta para Em preparo para a Produção corrigir os dados.",
    placeholder: "Ex.: horário de envase não confere com a ficha",
    confirm: "Devolver",
    done: (n: number) => `Batelada #${n} devolvida à Produção.`,
  },
} as const;

export function ReasonDialog({
  batch,
  action,
  readOnly = false,
  onClose,
  onDone,
}: {
  batch: BatchDTO;
  action: "reter" | "devolver";
  readOnly?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const copy = REASON_COPY[action];
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/batches/${batch.id}/transition`, { method: "POST", body: { action, reason } });
      onDone(copy.done(batch.number));
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      eyebrow="Qualidade"
      title={copy.title}
      onClose={onClose}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="reason-form"
            variant={action === "reter" ? "danger" : "primary"}
            loading={busy}
            disabled={readOnly || reason.trim().length < 3}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <form id="reason-form" onSubmit={submit} className="space-y-4">
        {readOnly && <ReadOnlyNotice />}
        <BatchHeadline batch={batch} />
        <Field label={copy.label} hint={copy.help}>
          <textarea
            className={cn(inputCls, "h-28 resize-none py-2.5")}
            value={reason}
            maxLength={500}
            autoFocus
            placeholder={copy.placeholder}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}

/* ───────────── Etapa 3 · Compositor de caixas ───────────── */

export function FinishDialog({
  batch,
  products,
  readOnly = false,
  onClose,
  onDone,
}: {
  batch: BatchDTO;
  products: ProductDTO[];
  readOnly?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const multiProduct = products.length > 1;
  const maxOutputs = Math.max(3, products.length * 3);
  const options = products.flatMap((p) =>
    p.packaging
      .filter((o) => o.active)
      .map((o) => ({ ...o, productFormat: p.format })),
  );
  // Mapa embalagem → quantidade digitada. Com uma única opção, já vem marcada.
  const [qty, setQty] = useState<Record<number, string>>(() => (options.length === 1 ? { [options[0].id]: "" } : {}));
  const [finishStart, setFinishStart] = useState(() => toLocalInput(batch.finishStart ?? null));
  const [finishEnd, setFinishEnd] = useState(() => toLocalInput(batch.finishEnd ?? null));
  const [busy, setBusy] = useState<"save" | "finish" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finishStartIso = fromLocalInput(finishStart);
  const finishEndIso = fromLocalInput(finishEnd);
  const timeError = finishOrderError({ finishStart: finishStartIso, finishEnd: finishEndIso });
  const missingTimes = missingForFinish({ finishStart: finishStartIso, finishEnd: finishEndIso });

  const good = batch.goodUnits ?? 0;
  const lines = options.filter((o) => o.id in qty).map((o) => ({ option: o, boxes: parseInt(qty[o.id], 10) || 0 }));
  const used = lines.reduce((acc, l) => acc + l.boxes * l.option.unitsPerBox, 0);
  const left = good - used;
  const totalBoxes = lines.reduce((acc, l) => acc + l.boxes, 0);
  const atLimit = lines.length >= maxOutputs;
  const canSaveTimes = !readOnly && !timeError;
  const ready = !readOnly && !timeError && missingTimes.length === 0 && lines.length > 0 && lines.every((l) => l.boxes > 0) && left >= 0;

  function toggle(id: number) {
    setQty((cur) => {
      if (id in cur) {
        const { [id]: _removed, ...rest } = cur;
        return rest;
      }
      return Object.keys(cur).length >= maxOutputs ? cur : { ...cur, [id]: "" };
    });
  }

  function fillMax(id: number, unitsPerBox: number) {
    const others = lines.filter((l) => l.option.id !== id).reduce((acc, l) => acc + l.boxes * l.option.unitsPerBox, 0);
    setQty((cur) => ({ ...cur, [id]: String(Math.max(0, Math.floor((good - others) / unitsPerBox))) }));
  }

  async function saveTimes() {
    if (!canSaveTimes) return;
    setBusy("save");
    setError(null);
    try {
      await api(`/api/batches/${batch.id}`, {
        method: "PATCH",
        body: { finishStart: finishStartIso, finishEnd: finishEndIso },
      });
      onDone(`Horários de acabamento da batelada #${batch.number} salvos.`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy("finish");
    setError(null);
    try {
      await api(`/api/batches/${batch.id}/transition`, {
        method: "POST",
        body: {
          action: "finalizar",
          finishStart: finishStartIso,
          finishEnd: finishEndIso,
          outputs: lines.map((l) => ({ packagingOptionId: l.option.id, boxes: l.boxes })),
        },
      });
      onDone(`Batelada #${batch.number} finalizada: ${fmtInt(totalBoxes)} caixas no estoque.`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(null);
    }
  }

  return (
    <Modal
      eyebrow="Acabamento"
      title="Definir caixas e acabamento"
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy !== null} className="mr-auto">
            Cancelar
          </Button>
          <Button variant="outline" loading={busy === "save"} disabled={!canSaveTimes || busy !== null} onClick={() => void saveTimes()}>
            Salvar horários
          </Button>
          <Button type="submit" form="finish-form" loading={busy === "finish"} disabled={!ready || busy !== null}>
            Finalizar e enviar ao estoque
          </Button>
        </>
      }
    >
      <form id="finish-form" onSubmit={submit} className="space-y-5">
        {readOnly && <ReadOnlyNotice />}
        <BatchHeadline batch={batch} />

        <div>
          <SectionTitle
            aside={
              <span className={cn("tnum text-xs", timeError ? "font-semibold text-stop" : "text-ink-3")}>
                {timeError
                  ? "Fim anterior ao início"
                  : finishStartIso && finishEndIso
                    ? `Duração: ${fmtDuration(finishStartIso, finishEndIso)}`
                    : ""}
              </span>
            }
          >
            1 · Horários do acabamento
          </SectionTitle>
          <fieldset className={cn("rounded-lg border bg-card p-3", timeError ? "border-stop" : "border-line")}>
            <legend className="sr-only">Acabamento</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["Início", "finishStart", finishStart, setFinishStart],
                ["Fim", "finishEnd", finishEnd, setFinishEnd],
              ] as const).map(([label, key, value, setter]) => (
                <div key={key}>
                  <label htmlFor={`f-${key}`} className="mb-1 block text-xs font-semibold text-ink-2">
                    {label}
                    <span className="sr-only"> de acabamento</span>
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      id={`f-${key}`}
                      type="datetime-local"
                      className={cn(inputCls, "tnum px-2")}
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setter(toLocalInput(new Date().toISOString()))}
                      className="flex h-11 shrink-0 items-center gap-1 rounded-lg border border-ink/25 bg-white px-2.5 text-xs font-bold text-ink transition hover:border-ink"
                      aria-label={`Usar a hora atual em ${label.toLowerCase()} de acabamento`}
                    >
                      <Clock aria-hidden className="size-3.5" />
                      Agora
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </fieldset>
          {missingTimes.length > 0 && !timeError && (
            <p className="mt-2 rounded-lg bg-acab-soft px-3 py-2 text-xs text-acab">
              <span className="font-bold">Pode salvar os horários agora e finalizar depois.</span> Para concluir o acabamento ainda falta:{" "}
              {missingTimes.join(", ").toLowerCase()}.
            </p>
          )}
        </div>

        {options.length === 0 ? (
          <ErrorNote>
            Este produto ainda não tem embalagens de saída cadastradas. Peça ao gestor para vincular em Admin › Produtos e
            embalagens.
          </ErrorNote>
        ) : (
          <>
            <div>
              <SectionTitle aside={<span className="text-xs text-ink-3">{lines.length} de {maxOutputs} escolhidas</span>}>
                2 · Embalagens de saída
              </SectionTitle>
              <div className="flex flex-wrap gap-2">
                {options.map((o) => {
                  const on = o.id in qty;
                  const title = multiProduct ? `${o.productFormat} · ${packLabel(o.label, o.unitsPerBox)}` : packLabel(o.label, o.unitsPerBox);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={on}
                      disabled={!on && atLimit}
                      onClick={() => toggle(o.id)}
                      className={cn(
                        "flex min-h-12 items-center gap-2 rounded-lg border-2 px-3.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40",
                        on ? "border-ink bg-ink text-paper" : "border-ink/25 bg-white text-ink hover:border-ink",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn("grid size-5 place-items-center rounded border-2", on ? "border-hivis bg-hivis text-ink" : "border-ink/30")}
                      >
                        {on && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      {title}
                    </button>
                  );
                })}
              </div>
              {atLimit && options.length > maxOutputs && (
                <p className="mt-2 text-xs text-ink-3">Limite de {maxOutputs} embalagens por batelada. Desmarque uma para trocar.</p>
              )}
            </div>

            <div>
              <SectionTitle>3 · Quantidade produzida de cada uma</SectionTitle>
              {lines.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink/25 px-3 py-5 text-center text-sm text-ink-3">
                  Escolha ao menos uma embalagem acima.
                </p>
              ) : (
                <ul className="space-y-2">
                  {lines.map(({ option, boxes }) => {
                    const optionTitle = multiProduct
                      ? `${option.productFormat} · ${packLabel(option.label, option.unitsPerBox)}`
                      : packLabel(option.label, option.unitsPerBox);
                    return (
                    <li
                      key={option.id}
                      className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-card p-3 sm:grid-cols-[1fr_11rem_auto]"
                    >
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold">{optionTitle}</p>
                        <p className="tnum text-xs text-ink-3">
                          {fmtInt(boxes)} cx × {option.unitsPerBox} = <span className="font-semibold text-ink-2">{fmtInt(boxes * option.unitsPerBox)} un</span>
                        </p>
                      </div>
                      <div className="max-sm:col-span-2 max-sm:row-start-2">
                        <Stepper
                          label={`caixas de ${optionTitle}`}
                          value={qty[option.id]}
                          onChange={(v) => setQty((cur) => ({ ...cur, [option.id]: v }))}
                        />
                      </div>
                      <Button size="sm" variant="outline" onClick={() => fillMax(option.id, option.unitsPerBox)} title="Preencher com o máximo que cabe no saldo de unidades">
                        Máx.
                      </Button>
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div
              className={cn("rounded-lg border-2 p-3", left < 0 ? "border-stop bg-stop-soft" : "border-ink/15 bg-card")}
              aria-live="polite"
            >
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold">
                  <span className="tnum">{fmtInt(used)}</span> de <span className="tnum">{fmtInt(good)}</span> unidades encaixotadas
                </span>
                <span className={cn("tnum shrink-0 font-bold", left < 0 ? "text-stop" : "text-ink-2")}>
                  {left < 0 ? `${fmtInt(-left)} a mais` : `sobram ${fmtInt(left)}`}
                </span>
              </div>
              <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-ink/10">
                <div
                  className={cn("h-full rounded-full transition-all", left < 0 ? "bg-stop" : "bg-acab")}
                  style={{ width: `${good > 0 ? Math.min(100, (used / good) * 100) : 0}%` }}
                />
              </div>
              {left < 0 && (
                <p className="mt-2 text-sm font-medium text-stop">
                  As caixas somam mais unidades do que as {fmtInt(good)} boas desta batelada. Reduza as quantidades.
                </p>
              )}
            </div>
          </>
        )}
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}

/* ───────────── Etapa 4 · Separar pedido ───────────── */

export function ShipDialog({
  stock,
  readOnly = false,
  onClose,
  onDone,
}: {
  stock: StockRowDTO[];
  readOnly?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const available = stock.filter((s) => s.balance > 0);
  const [optionId, setOptionId] = useState<number | null>(available.length === 1 ? available[0].packagingOptionId : null);
  const [boxes, setBoxes] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [customer, setCustomer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = available.find((s) => s.packagingOptionId === optionId);
  const n = parseInt(boxes, 10) || 0;
  const over = item ? n > item.balance : false;
  const ready = !readOnly && !!item && n > 0 && !over && orderRef.trim().length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || !item) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/shipments", {
        method: "POST",
        body: { packagingOptionId: item.packagingOptionId, boxes: n, orderRef, customer },
      });
      onDone(`${fmtInt(n)} caixa(s) separadas para o pedido ${orderRef.trim()}.`);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      eyebrow="Estoque e Logística"
      title="Separar pedido"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" form="ship-form" loading={busy} disabled={!ready}>
            Confirmar separação
          </Button>
        </>
      }
    >
      <form id="ship-form" onSubmit={submit} className="space-y-5">
        {readOnly && <ReadOnlyNotice />}
        <fieldset>
          <legend className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Item do estoque</legend>
          <div className="space-y-1.5">
            {available.map((s) => {
              const on = s.packagingOptionId === optionId;
              return (
                <label
                  key={s.packagingOptionId}
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 transition",
                    on ? "border-ink bg-card" : "border-ink/15 bg-white hover:border-ink/50",
                  )}
                >
                  <input
                    type="radio"
                    name="stock-item"
                    className="size-4 accent-ink"
                    checked={on}
                    onChange={() => {
                      setOptionId(s.packagingOptionId);
                      setBoxes("");
                    }}
                  />
                  <ProductTag brand={s.brand} format={s.format} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{packLabel(s.label, s.unitsPerBox)}</span>
                  <span className="tnum shrink-0 text-sm text-ink-2">
                    <span className="font-bold text-ink">{fmtInt(s.balance)}</span> cx
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <span className="mb-1.5 block text-[13px] font-semibold">Caixas a separar</span>
            <Stepper label="caixas a separar" value={boxes} onChange={setBoxes} max={item?.balance} />
            <p className={cn("mt-1 text-xs", over ? "font-semibold text-stop" : "text-ink-3")}>
              {item
                ? over
                  ? `Acima do saldo: há ${fmtInt(item.balance)} caixas.`
                  : `Saldo após separar: ${fmtInt(item.balance - n)} caixas`
                : "Escolha um item primeiro."}
            </p>
          </div>
          <Field label="Nº do pedido">
            <input
              className={cn(inputCls, "font-mono")}
              value={orderRef}
              maxLength={40}
              placeholder="PED-1043"
              onChange={(e) => setOrderRef(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Cliente / destino" optional>
          <input className={inputCls} value={customer} maxLength={80} onChange={(e) => setCustomer(e.target.value)} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
      </form>
    </Modal>
  );
}
