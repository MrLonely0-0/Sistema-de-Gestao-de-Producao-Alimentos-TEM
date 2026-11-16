"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { SPLASH_FADE_MS } from "@/lib/branding-shared";

/** Prévia usa a própria imagem selecionada/salva e a mesma animação do splash. */
export function SplashPreview({ source, onClose }: { source: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    const timer = setTimeout(() => setLeaving(true), 2600);
    return () => { clearTimeout(timer); element?.close(); };
  }, []);

  useEffect(() => {
    if (!leaving) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => closeRef.current(), reduced ? 100 : SPLASH_FADE_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <dialog ref={dialog} aria-label="Prévia do carregamento" className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-hidden border-0 bg-black p-0"
      onCancel={(e) => { e.preventDefault(); setLeaving(true); }}>
      <div className="cosmic-splash" data-phase={leaving ? "leaving" : "visible"}>
        <div className="cosmic-splash__center">
          <div className="cosmic-splash__pulse">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {!failed && <img className="cosmic-splash__image" src={source} alt="Prévia da arte de carregamento" onError={() => setFailed(true)} />}
          </div>
        </div>
        <button type="button" aria-label="Fechar prévia" onClick={() => setLeaving(true)} className="absolute right-4 top-4 grid size-11 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
          <X aria-hidden className="size-5" />
        </button>
        <p className="absolute inset-x-4 bottom-6 text-center text-xs text-white/60">{failed ? "Não foi possível abrir esta imagem. Escolha o PNG original novamente." : "Prévia · fecha automaticamente"}</p>
      </div>
    </dialog>
  );
}
