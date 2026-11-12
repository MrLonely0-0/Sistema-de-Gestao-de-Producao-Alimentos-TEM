"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { CircleAlert, CircleCheck, LoaderCircle, X } from "lucide-react";
import type { Stage, Status } from "@/lib/domain";
import { STATUS_LABEL } from "@/lib/domain";

export const cn = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

export function PanelCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-line bg-card p-4", className)}>{children}</div>;
}

/* ───────────── Cores por etapa e por status (classes estáticas p/ o Tailwind) ───────────── */

export const STAGE_STYLE: Record<Stage, { bar: string; text: string; soft: string }> = {
  producao: { bar: "bg-prod", text: "text-prod", soft: "bg-prod-soft" },
  qualidade: { bar: "bg-qual", text: "text-qual", soft: "bg-qual-soft" },
  acabamento: { bar: "bg-acab", text: "text-acab", soft: "bg-acab-soft" },
  estoque: { bar: "bg-ink", text: "text-ink", soft: "bg-paper-deep" },
};

/** Cores por cor de painel configurável. */
export const ACCENT_STYLE: Record<string, { bar: string; text: string; soft: string }> = {
  prod: { bar: "bg-prod", text: "text-prod", soft: "bg-prod-soft" },
  qual: { bar: "bg-qual", text: "text-qual", soft: "bg-qual-soft" },
  acab: { bar: "bg-acab", text: "text-acab", soft: "bg-acab-soft" },
  ink: { bar: "bg-ink", text: "text-ink", soft: "bg-paper-deep" },
  hivis: { bar: "bg-hivis", text: "text-ink", soft: "bg-hivis/30" },
  ok: { bar: "bg-ok", text: "text-ok", soft: "bg-ok-soft" },
  stop: { bar: "bg-stop", text: "text-stop", soft: "bg-stop-soft" },
};

export const STATUS_STYLE: Record<Status, { pill: string; edge: string }> = {
  em_preparo: { pill: "bg-prod-soft text-prod", edge: "bg-prod" },
  pronto: { pill: "bg-qual-soft text-qual", edge: "bg-qual" },
  retido: { pill: "bg-stop-soft text-stop", edge: "bg-stop" },
  liberado: { pill: "bg-ok-soft text-ok", edge: "bg-ok" },
  em_estoque: { pill: "bg-ink text-paper", edge: "bg-ink" },
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        s.pill,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", status === "em_estoque" ? "bg-hivis" : s.edge)} />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Etiqueta marca + formato. TEM em tinta/amarelo; demais marcas em papel. */
export function ProductTag({ brand, format, size = "sm" }: { brand: string; format: string; size?: "sm" | "md" }) {
  const house = brand.trim().toUpperCase() === "TEM";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-stretch overflow-hidden rounded border border-ink font-bold leading-none",
        size === "md" ? "text-[13px]" : "text-[11px]",
      )}
    >
      <span className={cn("px-1.5 py-1 uppercase tracking-wide", house ? "bg-ink text-hivis" : "border-r border-ink bg-white text-ink")}>
        {brand}
      </span>
      <span className="tnum bg-card px-1.5 py-1 text-ink">{format}</span>
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group flex h-9 shrink-0 items-center gap-2 rounded-lg px-1 text-xs font-semibold text-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className={cn("relative h-6 w-10 rounded-full transition", checked ? "bg-ok" : "bg-ink/25")}>
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      <span aria-hidden className="w-11 text-left">
        {checked ? "Ativo" : "Inativo"}
      </span>
    </button>
  );
}

/* ───────────── Botão ───────────── */

const VARIANTS = {
  primary: "bg-ink text-paper hover:bg-black",
  hivis: "bg-hivis text-ink hover:brightness-95",
  ok: "bg-ok text-white hover:brightness-110",
  danger: "bg-stop text-white hover:brightness-110",
  outline: "border border-ink/25 bg-card text-ink hover:border-ink/70",
  "outline-danger": "border border-stop/45 bg-card text-stop hover:bg-stop-soft",
  ghost: "text-ink-2 hover:bg-ink/8 hover:text-ink",
} as const;

const SIZES = {
  sm: "h-9 px-3 text-[13px]",
  md: "h-11 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof VARIANTS;
  size?: keyof typeof SIZES;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold transition select-none disabled:cursor-not-allowed disabled:opacity-45",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ───────────── Campos ───────────── */

export const inputCls =
  "h-11 w-full min-w-0 rounded-lg border border-ink/25 bg-white px-3 text-base text-ink outline-none transition placeholder:text-ink-3/70 focus:border-ink focus:ring-2 focus:ring-hivis disabled:bg-paper-deep disabled:text-ink-3";

export function Field({
  label,
  hint,
  optional,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-2 text-[13px] font-semibold text-ink">
        {label}
        {optional && <span className="font-normal text-ink-3">opcional</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg bg-stop-soft px-3 py-2.5 text-sm font-medium text-stop">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{children}</h3>
      {aside}
    </div>
  );
}

/* ───────────── Modal / Gaveta (elemento <dialog> nativo: foco preso e Esc de graça) ───────────── */

export function Modal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  variant = "center",
  width = "max-w-xl",
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  variant?: "center" | "drawer";
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const raiseToasts = useContext(RaiseToastsContext);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
    raiseToasts();
    return () => {
      if (el?.open) el.close();
    };
  }, [raiseToasts]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "fixed flex-col overflow-hidden bg-paper p-0 text-ink shadow-2xl open:flex",
        variant === "drawer"
          ? "inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-[36rem] animate-drawer"
          : cn("inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] animate-pop rounded-2xl", width),
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-card px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">{eyebrow}</div>}
          <h2 id={titleId} className="display text-[26px]">
            {title}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="-mr-1.5 grid size-10 shrink-0 place-items-center rounded-lg text-ink-2 transition hover:bg-ink/8 hover:text-ink"
        >
          <X aria-hidden className="size-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      {footer && (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-card px-4 py-3 sm:px-5">
          {footer}
        </footer>
      )}
    </dialog>
  );
}

/* ───────────── Toasts ───────────── */

type ToastKind = "ok" | "error";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});
/** Recoloca os avisos visíveis acima de um <dialog> que acabou de abrir. */
const RaiseToastsContext = createContext<() => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const push = useCallback((message: string, kind: ToastKind = "ok") => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-2), { id, kind, message }]);
    window.setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), kind === "error" ? 7000 : 3800);
  }, []);

  // `popover` coloca os avisos na camada superior do navegador, acima de
  // qualquer <dialog> aberto. A camada é uma pilha: quem abre por último fica
  // por cima — por isso reabrimos a cada aviso novo e a cada modal aberto.
  const show = useCallback((visible: boolean) => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      if (visible) el.showPopover();
    } catch {
      /* navegador sem suporte: os avisos continuam visíveis fora de modais */
    }
  }, []);

  const count = items.length;
  useEffect(() => show(count > 0), [show, count, items]);
  const raise = useCallback(() => {
    if (ref.current?.childElementCount) show(true);
  }, [show]);

  return (
    <ToastContext.Provider value={push}>
      <RaiseToastsContext.Provider value={raise}>{children}</RaiseToastsContext.Provider>
      <div
        ref={ref}
        popover="manual"
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-auto left-1/2 top-3 m-0 w-[min(26rem,calc(100vw-1.5rem))] -translate-x-1/2 flex-col gap-2 overflow-visible border-0 bg-transparent p-0 open:flex sm:left-4 sm:top-auto sm:bottom-4 sm:translate-x-0"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex animate-pop items-start gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-xl",
              t.kind === "error" ? "bg-stop text-white" : "bg-ink text-paper",
            )}
          >
            {t.kind === "error" ? (
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            ) : (
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-hivis" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
