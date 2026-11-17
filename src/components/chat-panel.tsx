"use client";

import { usePageLoading } from "@/components/splash-provider";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Hash, ImagePlus, Lock, MessageSquare, Pencil, Plus, RefreshCw, Send, Settings2, Trash2, UserRound, Users, X } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { UserAvatar } from "@/components/user-avatar";
import { hasAdminCapability, isReadOnly, roleLabel, type ChatChannelDTO, type ChatDTO } from "@/lib/domain";
import { api, errMsg, fmtAgo, fmtDateTime } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal, SectionTitle, useToast } from "@/components/ui";

const MAX_BYTES = 1_500_000;

/** Reduz a foto no próprio aparelho antes de enviar (economiza dados e respeita o limite). */
function compressImage(file: File): Promise<{ data: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a foto."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Arquivo de imagem inválido."));
      img.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Navegador não suporta o processamento da imagem."));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        let quality = 0.82;
        let data = canvas.toDataURL("image/jpeg", quality);
        while (data.length > MAX_BYTES && quality > 0.4) {
          quality -= 0.12;
          data = canvas.toDataURL("image/jpeg", quality);
        }
        if (data.length > MAX_BYTES) return reject(new Error("A foto continua grande. Aproxime-se e tente novamente."));
        resolve({ data, name: file.name || "foto.jpg" });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function ChatPanel() {
  const user = useAuth();
  const toast = useToast();
  const [data, setData] = useState<ChatDTO | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ data: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  usePageLoading(data === null && error === null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState<{ id: number; content: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: number } | null>(null);
  const [manage, setManage] = useState(false);
  const [newDirect, setNewDirect] = useState(false);
  const [channelForm, setChannelForm] = useState<ChatChannelDTO | "new" | null>(null);
  const [archiving, setArchiving] = useState<ChatChannelDTO | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const lastCount = useRef<number>(0);
  const readOnly = isReadOnly(user.role);
  const isAdmin = !readOnly && hasAdminCapability(user, "moderar_chat");
  const showManage = isAdmin || readOnly;

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setError(null);
    try {
      const res = await api<ChatDTO>(`/api/chat${selected ? `?channelId=${selected}` : ""}`);
      setData(res);
      setError(null);
      if (selected && !readOnly) void api("/api/chat/read", { method: "POST", body: { channelId: selected } }).catch(() => {});
      if (res.messages.length > lastCount.current && lastCount.current > 0 && selected) {
        const last = res.messages[res.messages.length - 1];
        if (last && last.authorName !== user.name) toast(`Nova mensagem de ${last.authorName}.`);
      }
      lastCount.current = res.messages.length;
    } catch (e) {
      if (showSpinner) setError(errMsg(e));
    }
  }, [selected, toast, user.name, readOnly]);

  useEffect(() => {
    if (data && selected === null) setSelected(data.activeChannelId);
  }, [data, selected]);

  useEffect(() => {
    void load(true);
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "nearest" }); }, [data?.messages.length, selected]);

  const allChannels = [...(data?.channels ?? []), ...(data?.direct ?? [])];
  const current = allChannels.find((c) => c.id === selected);
  const totalUnread = allChannels.reduce((acc, c) => acc + c.unreadCount, 0);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    try {
      setPhoto(await compressImage(file));
    } catch (e) {
      toast(errMsg(e), "error");
    }
  }

  async function send() {
    if (readOnly || !selected || (!text.trim() && !photo) || sending) return;
    setSending(true);
    try {
      await api("/api/chat", { method: "POST", body: { channelId: selected, content: text, imageData: photo?.data ?? null, imageName: photo?.name ?? null } });
      setText("");
      setPhoto(null);
      if (galleryRef.current) galleryRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
      await load();
    } catch (e) { toast(errMsg(e), "error"); }
    finally { setSending(false); }
  }

  async function startDirect(peerId: number) {
    setBusy(true);
    try {
      const { channelId } = await api<{ channelId: number }>("/api/chat/direct", { method: "POST", body: { userId: peerId } });
      setNewDirect(false);
      setSelected(channelId);
      lastCount.current = 0;
      await load();
    } catch (e) { toast(errMsg(e), "error"); }
    finally { setBusy(false); }
  }

  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  function openChannel(c: ChatChannelDTO | "new") {
    setChannelName(c === "new" ? "" : c.name);
    setChannelDescription(c === "new" ? "" : c.description ?? "");
    setDialogError(null);
    setChannelForm(c);
  }
  async function saveChannel(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setDialogError(null);
    const form = channelForm;
    try {
      await api("/api/chat/channels", { method: form === "new" ? "POST" : "PATCH", body: form === "new" ? { name: channelName, description: channelDescription } : { id: form?.id, name: channelName, description: channelDescription } });
      setChannelForm(null); await load(); toast("Canal salvo.");
    } catch (err) { setDialogError(errMsg(err)); }
    finally { setBusy(false); }
  }

  return <>
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-3 pb-6 pt-5 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Colaboradores</p>
            <h1 className="display mt-1.5 text-[34px]">Conversa da equipe</h1>
            <p className="mt-1.5 text-sm text-ink-2">Canais abertos e conversas particulares. Envie texto, fotos da galeria ou tiradas na hora.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="hivis" icon={<UserRound aria-hidden className="size-4" />} onClick={() => setNewDirect(true)}>Conversa particular</Button>
            {showManage && <Button variant="outline" icon={<Settings2 aria-hidden className="size-4" />} onClick={() => setManage(true)}>Gerenciar canais</Button>}
            <Button variant="outline" aria-label="Atualizar conversa" onClick={() => void load(true)} icon={<RefreshCw aria-hidden className={cn("size-4", busy && "animate-spin")} />} />
          </div>
        </div>
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        <div className="mt-5 grid overflow-hidden rounded-xl border border-line bg-card md:grid-cols-[250px_1fr]">
          <aside className="border-r border-line bg-paper-deep/50 p-2.5">
            <p className="flex items-center gap-1.5 px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
              <Users aria-hidden className="size-3.5" /> Canais da equipe {totalUnread > 0 && <span className="ml-auto rounded bg-hivis px-1.5 text-[10px] text-ink">{totalUnread}</span>}
            </p>
            <ul className="space-y-1">
              {data?.channels.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { setSelected(c.id); lastCount.current = 0; }} className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-semibold transition", selected === c.id ? "bg-ink text-paper" : "text-ink-2 hover:bg-ink/8")}>
                    <Hash aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.unreadCount > 0 && <span className="tnum rounded bg-hivis px-1.5 text-[11px] text-ink">{c.unreadCount > 99 ? "99+" : c.unreadCount}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex items-center gap-1.5 px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
              <Lock aria-hidden className="size-3.5" /> Particulares
            </p>
            <ul className="space-y-1">
              {data?.direct.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { setSelected(c.id); lastCount.current = 0; }} className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-semibold transition", selected === c.id ? "bg-ink text-paper" : "text-ink-2 hover:bg-ink/8")}>
                    <UserRound aria-hidden className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.unreadCount > 0 && <span className="tnum rounded bg-hivis px-1.5 text-[11px] text-ink">{c.unreadCount}</span>}
                  </button>
                </li>
              ))}
              {!data?.direct.length && <li><button type="button" onClick={() => setNewDirect(true)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-ink-3 hover:bg-ink/8"><Plus aria-hidden className="size-4" />Iniciar conversa</button></li>}
            </ul>
            {!data && <p className="px-2 py-4 text-xs text-ink-3">Carregando…</p>}
          </aside>

          <section className="flex min-h-[30rem] flex-col">
            <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
              {current?.kind === "direct" ? <Lock aria-hidden className="size-4 text-ink-3" /> : <Hash aria-hidden className="size-4 text-ink-3" />}
              <h2 className="truncate text-[17px] font-bold">{current?.name ?? "Selecione um canal"}</h2>
              {current?.kind === "direct" && <span className="rounded bg-paper-deep px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-2">particular</span>}
              <span className="ml-auto hidden text-xs text-ink-3 sm:block">Atualiza a cada 5 s</span>
            </header>

            <div className="min-h-64 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {!selected && <p className="py-10 text-center text-sm text-ink-3">Nenhum canal disponível.</p>}
              {selected && !data?.messages.length && (
                <div className="grid place-items-center py-10 text-center">
                  <MessageSquare aria-hidden className="mb-2 size-8 text-ink-3" />
                  <p className="text-sm font-semibold">Comece a conversa</p>
                  <p className="mt-1 text-xs text-ink-3">Envie a primeira mensagem para {current?.name}.</p>
                </div>
              )}
              {data?.messages.map((m) => {
                const mine = m.isMine ?? m.authorName === user.name;
                return (
                  <article key={m.id} className={cn("flex items-start gap-2.5", mine && "flex-row-reverse")}>
                    <UserAvatar name={m.authorName} url={m.avatarUrl} className={mine ? "bg-ink text-hivis" : "bg-paper-deep text-ink"} />
                    <div className={cn("min-w-0 flex-1", mine && "text-right")}>
                      <div className={cn("flex flex-wrap items-baseline gap-x-2", mine && "justify-end")}>
                        <span className="text-[13px] font-bold">{mine ? "Você" : m.authorName}</span>
                        <span className="text-[11px] text-ink-3">{roleLabel(m.authorRole)}</span>
                        <time className="tnum text-[11px] text-ink-3" title={fmtDateTime(m.createdAt)}>{fmtAgo(m.createdAt)}</time>
                      </div>
                      {editing?.id === m.id ? (
                        <form className="mt-1.5" onSubmit={(e) => { e.preventDefault(); void api("/api/chat", { method: "PATCH", body: { id: m.id, content: editing.content } }).then(() => { setEditing(null); return load(); }).catch((err) => toast(errMsg(err), "error")); }}>
                          <textarea autoFocus className={cn(inputCls, "h-20 resize-none py-2 text-left")} value={editing.content} maxLength={4000} onChange={(e) => setEditing({ id: m.id, content: e.target.value })} />
                          <div className="mt-1.5 flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button><Button size="sm" type="submit">Salvar</Button></div>
                        </form>
                      ) : (
                        <div className={cn("mt-1 inline-block max-w-full rounded-lg px-3 py-2 text-left", mine ? "bg-ink text-paper" : "bg-paper-deep/45 text-ink")}>
                          {m.imageData && (
                            <button type="button" onClick={() => setViewer(m.imageData)} className="mb-2 block overflow-hidden rounded-md">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={m.imageData} alt={m.imageName ?? "Foto enviada na conversa"} className="max-h-64 w-auto max-w-full object-contain" />
                            </button>
                          )}
                          {m.content && <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed [overflow-wrap:anywhere]">{m.content}</p>}
                          {m.editedAt && <span className="mt-1 block text-[10px] opacity-70">editada · {fmtDateTime(m.editedAt)}</span>}
                        </div>
                      )}
                      {!readOnly && (m.canEdit || m.canDelete) && editing?.id !== m.id && (
                        <div className={cn("mt-1 flex gap-1", mine && "justify-end")}>
                          {m.canEdit && <button type="button" aria-label={`Editar mensagem ${m.id}`} onClick={() => setEditing({ id: m.id, content: m.content })} className="rounded p-1 text-ink-3 hover:bg-ink/8 hover:text-ink"><Pencil aria-hidden className="size-3" /></button>}
                          {m.canDelete && <button type="button" aria-label={`Excluir mensagem ${m.id}`} onClick={() => setDeleting({ id: m.id })} className="rounded p-1 text-ink-3 hover:bg-stop-soft hover:text-stop"><Trash2 aria-hidden className="size-3" /></button>}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
              <div ref={bottom} />
            </div>

            <form className="shrink-0 border-t border-line bg-paper p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              {readOnly && (
                <p className="mb-2 rounded-lg bg-qual-soft px-3 py-2 text-xs font-medium text-qual">
                  Modo visualização (somente leitura): envio, fotos, criação e moderação estão desabilitados.
                </p>
              )}
              {photo && (
                <div className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-card p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.data} alt="Prévia da foto" className="size-14 rounded object-cover" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-2">Foto pronta para enviar</span>
                  <button type="button" aria-label="Remover foto" onClick={() => setPhoto(null)} className="rounded p-1 text-ink-3 hover:bg-stop-soft hover:text-stop"><X aria-hidden className="size-4" /></button>
                </div>
              )}
              <label className="sr-only" htmlFor="chat-message">Mensagem</label>
              <textarea id="chat-message" className={cn(inputCls, "h-20 resize-none py-2.5")} placeholder={readOnly ? "Envio desabilitado no modo visualização" : selected ? `Mensagem para ${current?.name}…` : "Selecione um canal"} value={text} maxLength={4000} disabled={readOnly || !selected} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Tirar foto com a câmera" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
              <input ref={galleryRef} type="file" accept="image/*" className="sr-only" aria-label="Anexar foto da galeria" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" disabled={readOnly || !selected} onClick={() => cameraRef.current?.click()} icon={<Camera aria-hidden className="size-4" />}>Câmera</Button>
                <Button type="button" size="sm" variant="outline" disabled={readOnly || !selected} onClick={() => galleryRef.current?.click()} icon={<ImagePlus aria-hidden className="size-4" />}>Foto</Button>
                <span className="hidden text-[11px] text-ink-3 sm:block">Enter envia · Shift+Enter quebra linha</span>
                <Button type="submit" variant="hivis" className="ml-auto" loading={sending} disabled={readOnly || !selected || (!text.trim() && !photo)} icon={<Send aria-hidden className="size-4" />}>Enviar</Button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>

    {newDirect && (
      <Modal eyebrow="Conversa" title="Nova conversa particular" onClose={() => setNewDirect(false)} width="max-w-lg">
        <p className="mb-3 text-sm text-ink-2">Escolha um colaborador. Só vocês dois verão as mensagens desta conversa.</p>
        {data?.peers.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {data.peers.map((p) => (
              <li key={p.id}><button type="button" disabled={busy || readOnly} onClick={() => void startDirect(p.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-paper-deep/60 disabled:cursor-not-allowed disabled:opacity-60"><UserRound aria-hidden className="size-4 text-ink-3" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{p.name}</span><span className="block text-xs text-ink-3">{p.roleLabel}</span></span><MessageSquare aria-hidden className="size-4 text-ink-3" /></button></li>
            ))}
          </ul>
        ) : <p className="rounded-lg border border-dashed border-ink/25 px-3 py-5 text-center text-sm text-ink-3">Nenhum outro colaborador cadastrado.</p>}
      </Modal>
    )}

    {viewer && (
      <Modal eyebrow="Foto" title="Visualizar foto" onClose={() => setViewer(null)} width="max-w-3xl">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={viewer} alt="Foto ampliada da conversa" className="max-h-[70vh] w-full object-contain" />
      </Modal>
    )}

    {channelForm && (
      <Modal eyebrow="Canais de conversa" title={channelForm === "new" ? "Novo canal" : `Editar #${channelForm.name}`} onClose={() => setChannelForm(null)} width="max-w-lg" footer={<><Button variant="ghost" onClick={() => setChannelForm(null)} disabled={busy}>Cancelar</Button><Button type="submit" form="channel-form" loading={busy} disabled={readOnly || channelName.trim().length < 2}>Salvar canal</Button></>}>
        <form id="channel-form" onSubmit={(e) => void saveChannel(e)} className="space-y-3">
          <Field label="Nome do canal"><input className={inputCls} autoFocus value={channelName} maxLength={40} onChange={(e) => setChannelName(e.target.value)} /></Field>
          <Field label="Descrição" optional><input className={inputCls} value={channelDescription} maxLength={120} onChange={(e) => setChannelDescription(e.target.value)} /></Field>
          <ErrorNote>{dialogError}</ErrorNote>
        </form>
      </Modal>
    )}

    {manage && (
      <Modal eyebrow="Admin · conversa" title="Gerenciar canais" onClose={() => setManage(false)} width="max-w-xl">
        <div className="space-y-3">
          <p className="text-sm text-ink-2">Crie, renomeie ou arquive canais. Arquivar preserva as mensagens no banco.</p>
          <Button variant="hivis" icon={<Plus aria-hidden className="size-4" />} onClick={() => { setManage(false); openChannel("new"); }}>Novo canal</Button>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {data?.channels.map((c) => (
              <li key={c.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1"><p className="text-sm font-semibold">#{c.name}</p><p className="text-xs text-ink-3">{c.messageCount} mensagem(ns)</p></div>
                <Button size="sm" variant="ghost" aria-label={`Editar canal ${c.name}`} onClick={() => { setManage(false); openChannel(c); }} icon={<Pencil aria-hidden className="size-3.5" />}>Editar</Button>
                <Button size="sm" variant="ghost" aria-label={`Arquivar canal ${c.name}`} onClick={() => { setManage(false); setArchiving(c); }} icon={<Trash2 aria-hidden className="size-3.5" />}>Arquivar</Button>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    )}

    {archiving && (
      <Modal eyebrow="Conversa" title={`Arquivar #${archiving.name}?`} onClose={() => setArchiving(null)} width="max-w-lg" footer={<><Button variant="ghost" onClick={() => setArchiving(null)}>Cancelar</Button><Button variant="danger" loading={busy} disabled={readOnly} onClick={async () => { setBusy(true); try { await api(`/api/chat/channels?id=${archiving.id}`, { method: "DELETE" }); setArchiving(null); await load(); toast("Canal arquivado. Histórico preservado."); } catch (e) { toast(errMsg(e), "error"); } finally { setBusy(false); } }}>Arquivar</Button></>}>
        <p className="text-sm text-ink-2">O canal sai da lista, mas as mensagens ficam salvas para auditoria.</p>
      </Modal>
    )}

    {deleting && (
      <Modal eyebrow="Conversa" title="Excluir mensagem?" onClose={() => setDeleting(null)} width="max-w-md" footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>Cancelar</Button><Button variant="danger" disabled={readOnly} onClick={async () => { try { await api(`/api/chat?id=${deleting.id}`, { method: "DELETE" }); setDeleting(null); await load(); toast("Mensagem excluída."); } catch (e) { toast(errMsg(e), "error"); } }}>Excluir</Button></>}>
        <p className="text-sm text-ink-2">A mensagem sai da conversa. A exclusão é lógica e preserva o registro no banco.</p>
      </Modal>
    )}
  </>;
}
