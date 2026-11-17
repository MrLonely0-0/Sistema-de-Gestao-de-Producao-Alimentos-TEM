"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardPaste, FileImage, Play, ShieldCheck, Trash2, Upload } from "lucide-react";
import { api, errMsg } from "@/lib/client";
import { BRAND_IMAGE_MAX_BYTES, type BrandingInfo } from "@/lib/branding-shared";
import { Button, ErrorNote, PanelCard, SectionTitle } from "@/components/ui";
import { useReadOnly } from "@/components/auth-provider";
import { SplashPreview } from "@/components/splash-preview";

type BrandingResponse = { branding: BrandingInfo | null; imageDataUrl: string | null };
const signature = [137, 80, 78, 71, 13, 10, 26, 10];

export function BrandingPanel() {
  const readOnly = useReadOnly();
  const router = useRouter();
  const [branding, setBranding] = useState<BrandingInfo | null>(null);
  const [storedImage, setStoredImage] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [decodedSource, setDecodedSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showTest, setShowTest] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const previewUrl = useRef<string | null>(null);
  const selection = useRef(0);

  useEffect(() => {
    let active = true;
    api<BrandingResponse>("/api/admin/branding")
      .then((res) => { if (active) { setBranding(res.branding); setStoredImage(res.imageDataUrl); } })
      .catch((e) => { if (active) setError(errMsg(e)); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  function clearSelection() {
    selection.current++;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null); setFile(null);
    if (input.current) input.current.value = "";
  }

  async function select(next?: File) {
    if (!next || busy) return;
    const request = ++selection.current;
    setError(null); setSuccess(false);
    try {
      if (next.size > BRAND_IMAGE_MAX_BYTES) throw new Error("Limite de 5 MB para o PNG original.");
      const bytes = new Uint8Array(await next.slice(0, 8).arrayBuffer());
      if (!signature.every((v, i) => bytes[i] === v)) throw new Error("Este arquivo não é um PNG. Use a imagem original em formato PNG.");
      if (request !== selection.current) return;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      // Usa a assinatura real, pois alguns aparelhos não informam o MIME do arquivo.
      const png = next.type === "image/png" ? next : new File([next], next.name || "gato-cosmico.png", { type: "image/png" });
      previewUrl.current = URL.createObjectURL(png);
      setPreview(previewUrl.current); setFile(png);
    } catch (e) { if (request === selection.current) setError(errMsg(e)); }
  }

  async function paste() {
    setError(null);
    try {
      if (!navigator.clipboard?.read) throw new Error("A colagem automática não é suportada aqui. Selecione o arquivo PNG ou cole com Ctrl+V na área de importação.");
      const items = await navigator.clipboard.read();
      const item = items.find((c) => c.types.includes("image/png"));
      if (!item) throw new Error("A área de transferência não contém uma imagem PNG. Copie a imagem ou selecione o arquivo.");
      const blob = await item.getType("image/png");
      await select(new File([blob], "gato-cosmico.png", { type: "image/png" }));
    } catch (e) { setError(e instanceof DOMException ? "O navegador não permitiu ler a área de transferência. Use Selecionar PNG original." : errMsg(e)); }
  }

  async function save() {
    if (!file || readOnly) return;
    setBusy(true); setError(null); setSuccess(false);
    try {
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(`data:image/png;base64,${String(reader.result).split(",")[1]}`);
        reader.onerror = () => reject(new Error("Não foi possível ler o PNG."));
        reader.readAsDataURL(file);
      });
      const saved = await api<{ version: string }>("/api/admin/branding", { method: "POST", body: { name: file.name, imageData } });
      // Não anuncia sucesso antes de ler o arquivo de volta do banco e conferir seu conteúdo.
      const verified = await api<BrandingResponse>("/api/admin/branding");
      if (!verified.branding || verified.branding.version !== saved.version || verified.imageDataUrl !== imageData) {
        throw new Error("Não foi possível confirmar a imagem gravada. O arquivo selecionado foi mantido; tente aplicar novamente.");
      }
      setBranding(verified.branding); setStoredImage(verified.imageDataUrl);
      clearSelection(); setSuccess(true);
      router.refresh();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!storedImage || busy || readOnly) return;
    setBusy(true); setError(null); setSuccess(false);
    try {
      await api("/api/admin/branding", { method: "DELETE" });
      setBranding(null); setStoredImage(null); setDecodedSource(null);
      clearSelection();
      router.refresh();
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  const image = preview ?? storedImage;
  const canPreview = !!image && decodedSource === image;
  return (
    <div className="space-y-5">
      <div>
        <h2 className="display text-[26px]">Imagem de abertura e favicon</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-2">Escolha a imagem, confirme a prévia e aplique. O splash só é ativado com um PNG carregado de verdade.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_1.15fr]">
        <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-card">
          <div className="grid min-h-72 flex-1 place-items-center bg-black p-8" aria-label="Prévia da imagem sobre fundo preto">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="Prévia da imagem original" className="h-auto max-h-64 w-56 max-w-full object-contain"
                onLoad={() => setDecodedSource(image)}
                onError={() => { setDecodedSource(null); setError("Não foi possível abrir o PNG. Selecione novamente o arquivo original."); }} />
            ) : <span className="flex flex-col items-center gap-3 text-center text-sm text-white/55"><FileImage aria-hidden className="size-8" />{loaded ? "Nenhuma imagem salva." : "Conferindo imagem…"}</span>}
          </div>
          <div className="flex items-center justify-between gap-2 p-3">
            <span className="text-xs text-ink-3">Sem recorte, filtro ou mudança de proporção.</span>
            <Button size="sm" variant="outline" icon={<Play aria-hidden className="size-3.5" />} disabled={!canPreview || busy} onClick={() => setShowTest(true)}>Testar animação</Button>
          </div>
        </div>
        <PanelCard>
          <SectionTitle>Arquivo original</SectionTitle>
          {loaded && !storedImage && <p className="mb-4 rounded-lg bg-prod-soft p-3 text-sm text-prod">Ainda não há um PNG válido salvo. O splash está desativado para não mostrar uma tela preta vazia.</p>}
          {success && <p role="status" className="mb-4 flex items-start gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />Imagem salva e verificada no banco. Use Testar animação ou navegue para outra página.</p>}
          {branding && storedImage && <p className="mb-4 text-sm text-ink-2"><strong className="text-ink">{branding.originalName}</strong><br />{branding.width} × {branding.height} px · original preservado</p>}
          <div className="rounded-xl border border-dashed border-ink/30 bg-white p-4 text-center" tabIndex={0}
            aria-label="Área para selecionar, soltar ou colar a imagem PNG"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); void select(e.dataTransfer.files[0]); }}
            onPaste={(e) => { const file = Array.from(e.clipboardData.files).find((f) => f.type === "image/png"); if (file) { e.preventDefault(); void select(file); } }}>
            <input ref={input} type="file" accept="image/png,.png" className="sr-only" aria-label="PNG original do gato cósmico" onChange={(e) => void select(e.target.files?.[0])} disabled={busy} />
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" icon={<Upload aria-hidden className="size-4" />} onClick={() => input.current?.click()} disabled={busy}>Selecionar PNG original</Button>
              <Button variant="ghost" icon={<ClipboardPaste aria-hidden className="size-4" />} onClick={() => void paste()} disabled={busy}>Colar imagem</Button>
            </div>
            <p className="mt-2 text-xs text-ink-3">Ou arraste o arquivo · até 5 MB / 4096 × 4096 px</p>
            {file && <p className="mt-3 break-all text-sm font-semibold">{file.name}</p>}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="hivis" disabled={readOnly || !file || !loaded || !canPreview} loading={busy} onClick={() => void save()}>Aplicar imagem e favicons</Button>
            {file && <Button variant="ghost" disabled={busy} onClick={clearSelection}>Cancelar</Button>}
            {!file && storedImage && <Button variant="ghost" className="text-stop hover:bg-stop-soft hover:text-stop" disabled={readOnly || busy} icon={<Trash2 aria-hidden className="size-4" />} onClick={() => void remove()}>Remover imagem</Button>}
          </div>
          <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-3"><ShieldCheck aria-hidden className="mt-px size-4 shrink-0" />O original é salvo sem reprocessamento e incorporado à página. A confirmação só aparece depois de verificar o arquivo salvo.</p>
        </PanelCard>
      </div>
      {branding && storedImage && <PanelCard>
        <SectionTitle>Favicons gerados · tamanho real</SectionTitle>
        <div className="flex flex-wrap items-center gap-6">
          {[{ src: branding.icon16Url, size: 16 }, { src: branding.icon32Url, size: 32 }].map((icon) => <div key={icon.size} className="flex items-center gap-3">
            <span className="grid size-14 place-items-center rounded-lg bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={icon.src} width={icon.size} height={icon.size} alt={`Favicon ${icon.size} × ${icon.size}`} />
            </span><span className="font-mono text-xs text-ink-2">{icon.size} × {icon.size} PNG</span>
          </div>)}
        </div>
      </PanelCard>}
      {showTest && image && <SplashPreview source={image} onClose={() => setShowTest(false)} />}
    </div>
  );
}
