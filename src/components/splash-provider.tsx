"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type ComponentProps, type ReactNode,
} from "react";
import { SPLASH_FADE_MS, type BrandingInfo } from "@/lib/branding-shared";

type Phase = "visible" | "leaving" | "hidden";
type Release = () => void;
const noop = () => {};
const LoadingContext = createContext<{ hold: () => Release; navigate: (href: string) => void }>({ hold: () => noop, navigate: noop });

/**
 * Fail-open: sem PNG ou se ele não decodificar, NUNCA cobre o conteúdo de preto.
 * O original vem embutido no HTML e fica decodificado entre as navegações.
 */
export function SplashProvider({ branding, imageDataUrl, children }: {
  branding: BrandingInfo | null;
  imageDataUrl: string | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const source = branding && imageDataUrl ? imageDataUrl : null;
  const [phase, setPhase] = useState<Phase>("visible");
  const phaseRef = useRef<Phase>("visible");
  const [asset, setAsset] = useState<{ source: string | null; ready: boolean }>({ source: null, ready: false });
  const [slow, setSlow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const image = useRef<HTMLImageElement>(null);
  const gates = useRef(new Set<number>([0]));
  const seq = useRef(0);
  const route = useRef(pathname);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame1 = useRef<number | null>(null);
  const frame2 = useRef<number | null>(null);
  const navigation = useRef<Release | null>(null);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = !!source && asset.source === source && asset.ready;
  const showArtwork = ready && !dismissed && phase !== "hidden";

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const cancelExit = useCallback(() => {
    if (fadeTimer.current !== null) clearTimeout(fadeTimer.current);
    if (frame1.current !== null) cancelAnimationFrame(frame1.current);
    if (frame2.current !== null) cancelAnimationFrame(frame2.current);
    fadeTimer.current = null;
    frame1.current = null;
    frame2.current = null;
  }, []);

  const finishWhenIdle = useCallback(() => {
    if (gates.current.size > 0 || phaseRef.current === "hidden") return;
    cancelExit();
    frame1.current = requestAnimationFrame(() => {
      frame2.current = requestAnimationFrame(() => {
        if (gates.current.size > 0) return;
        setSlow(false);
        changePhase("leaving");
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        fadeTimer.current = setTimeout(() => {
          if (gates.current.size === 0) changePhase("hidden");
        }, reduced ? 100 : SPLASH_FADE_MS);
      });
    });
  }, [cancelExit, changePhase]);

  const hold = useCallback((): Release => {
    const id = ++seq.current;
    gates.current.add(id);
    cancelExit();
    if (phaseRef.current !== "visible") {
      setSlow(false);
      setDismissed(false);
      changePhase("visible");
    }
    return () => { if (gates.current.delete(id)) finishWhenIdle(); };
  }, [cancelExit, changePhase, finishWhenIdle]);

  const navigate = useCallback((href: string) => {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname === route.current) return;
    const release = hold();
    navigation.current?.();
    navigation.current = release;
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    navigationTimer.current = setTimeout(() => {
      navigation.current?.();
      navigation.current = null;
    }, 20_000);
  }, [hold]);

  useEffect(() => {
    if (route.current !== pathname) {
      route.current = pathname;
      navigation.current?.();
      navigation.current = null;
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
    }
  }, [pathname]);

  // Espera o DOM, não window.load: outra foto ou requisição lenta não pode
  // manter a aplicação escondida. Cada página registra seu carregamento real.
  useEffect(() => {
    const readyDocument = () => { gates.current.delete(0); finishWhenIdle(); };
    if (document.readyState !== "loading") readyDocument();
    else document.addEventListener("DOMContentLoaded", readyDocument, { once: true });
    const onPop = () => navigate(window.location.href);
    const onRestore = (e: PageTransitionEvent) => {
      if (e.persisted) { navigation.current?.(); navigation.current = null; readyDocument(); }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pageshow", onRestore);
    return () => {
      document.removeEventListener("DOMContentLoaded", readyDocument);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pageshow", onRestore);
      cancelExit();
      if (navigationTimer.current) clearTimeout(navigationTimer.current);
    };
  }, [cancelExit, finishWhenIdle, navigate]);

  // Também trata imagem que carregou ANTES da hidratação: não depende só de onLoad.
  useEffect(() => {
    const element = image.current;
    if (!source || !element) return;
    let active = true;
    let settled = false;
    const finish = (ok: boolean) => {
      if (!active || settled) return;
      settled = true;
      clearTimeout(timeout);
      setAsset({ source, ready: ok });
    };
    const loaded = () => {
      if (element.naturalWidth === 0) { finish(false); return; }
      if (typeof element.decode === "function") {
        void element.decode().then(() => finish(true)).catch(() => finish(false));
      } else finish(true);
    };
    const failed = () => finish(false);
    const timeout = setTimeout(failed, 5000);
    element.addEventListener("load", loaded);
    element.addEventListener("error", failed);
    if (element.complete) loaded();
    return () => {
      active = false;
      clearTimeout(timeout);
      element.removeEventListener("load", loaded);
      element.removeEventListener("error", failed);
    };
  }, [source]);

  useEffect(() => {
    if (phase !== "visible") return;
    const timeout = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(timeout);
  }, [phase]);

  useEffect(() => {
    if (!showArtwork || phase !== "visible") return;
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previous; };
  }, [showArtwork, phase]);

  return (
    <LoadingContext.Provider value={{ hold, navigate }}>
      <div aria-busy={phase === "visible"}>{children}</div>
      {phase === "visible" && !showArtwork && (
        <div className="page-loading-line" role="progressbar" aria-label="Carregando página"><span /></div>
      )}
      {source && branding && (
        <div
          className="cosmic-splash"
          data-phase={showArtwork ? phase : "hidden"}
          role="status"
          aria-live="polite"
          aria-label="Carregando o sistema"
          aria-hidden={!showArtwork || phase === "leaving"}
          inert={!showArtwork || phase === "leaving"}
        >
          <div className="cosmic-splash__center">
            <div className="cosmic-splash__pulse">
              {/* Original embutido, sem crop e sem uma segunda requisição HTTP. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={image} className="cosmic-splash__image" src={source}
                width={branding.width} height={branding.height} alt="" aria-hidden="true"
                loading="eager" decoding="async" />
            </div>
          </div>
          {slow && showArtwork && phase === "visible" && (
            <div className="cosmic-splash__slow">
              <p>A conexão está demorando mais que o esperado.</p>
              <button type="button" onClick={() => setDismissed(true)}>Continuar sem animação</button>
              <button type="button" onClick={() => window.location.reload()}>Tentar novamente</button>
            </div>
          )}
        </div>
      )}
      <noscript><style>{`.cosmic-splash, .page-loading-line { display: none !important; }`}</style></noscript>
    </LoadingContext.Provider>
  );
}

export function usePageLoading(active: boolean) {
  const { hold } = useContext(LoadingContext);
  useLayoutEffect(() => { if (active) return hold(); }, [active, hold]);
}

export function SplashLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const { navigate } = useContext(LoadingContext);
  return <Link {...props} onNavigate={(e) => {
    let cancelled = false;
    onNavigate?.({ preventDefault() { cancelled = true; e.preventDefault(); } });
    if (cancelled) return;
    const href = typeof props.href === "string" ? props.href : props.href.pathname;
    if (href) navigate(href);
  }} />;
}

export function RouteLoading() {
  usePageLoading(true);
  return <div className="grid min-h-40 place-items-center text-sm text-ink-3" role="status">Preparando página…</div>;
}
