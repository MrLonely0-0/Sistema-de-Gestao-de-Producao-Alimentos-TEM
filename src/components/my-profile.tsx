"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, CheckCircle2, Lock, Save, Trash2, Upload } from "lucide-react";
import { useAuth, useUpdateAuth } from "@/components/auth-provider";
import { usePageLoading } from "@/components/splash-provider";
import { UserAvatar } from "@/components/user-avatar";
import { roleLabel, type MyProfileDTO } from "@/lib/domain";
import { api, errMsg } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, PanelCard, SectionTitle } from "@/components/ui";

export function MyProfile() {
  const signedIn = useAuth();
  const updateAuth = useUpdateAuth();
  const [user, setUser] = useState<MyProfileDTO | null>(null);
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  usePageLoading(!user && !error);

  useEffect(() => {
    let live = true;
    api<{ user: MyProfileDTO }>("/api/account").then((res) => {
      if (!live) return;
      setUser(res.user); setName(res.user.name); setBio(res.user.bio ?? "");
    }).catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, []);

  async function pick(file?: File) {
    if (!file) return;
    setError(null); setSaved(null);
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Use uma foto JPG, PNG ou WebP."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("A foto deve ter até 5 MB."); return; }
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(new Error("Não foi possível ler a foto.")); r.readAsDataURL(file);
      });
      setPhoto(data);
    } catch (e) { setError(errMsg(e)); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault(); if (!user) return;
    setError(null); setSaved(null);
    if (newPassword && newPassword !== confirmPassword) { setError("A confirmação da nova senha não confere."); return; }
    setBusy(true);
    try {
      const response = await api<{ user: MyProfileDTO; passwordChanged: boolean }>("/api/account", {
        method: "PATCH", body: {
          ...(name.trim() ? { name: name.trim() } : {}), bio,
          ...(photo !== undefined ? { photoData: photo } : {}),
          ...(newPassword ? { currentPassword, newPassword, confirmPassword } : {}),
        },
      });
      setUser(response.user); updateAuth(response.user); setName(response.user.name); setBio(response.user.bio ?? "");
      setPhoto(undefined); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      if (gallery.current) gallery.current.value = ""; if (camera.current) camera.current.value = "";
      setSaved(response.passwordChanged ? "Perfil salvo e senha alterada. As outras sessões foram encerradas; você continua conectado aqui." : "Perfil atualizado. Sua identificação já foi atualizada no sistema.");
    } catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  }

  const displayName = name.trim() || user?.name || signedIn.name;
  const image = photo === undefined ? user?.avatarUrl : photo;
  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-4xl px-3 pb-10 pt-5 sm:px-6">
    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Minha conta</p>
    <h1 className="display mt-1.5 text-[34px]">Meu perfil</h1>
    <p className="mt-2 text-sm text-ink-2">Atualize sua identificação. Foto e descrição são opcionais; deixe a senha em branco para mantê-la.</p>
    <form onSubmit={submit} className="mt-5 grid items-start gap-4 md:grid-cols-[240px_1fr]">
      <PanelCard>
        <div className="flex flex-col items-center text-center">
          <UserAvatar name={displayName} url={image} className="size-28 border-4 border-white text-[32px] shadow-sm" />
          <p className="mt-3 break-words text-lg font-bold">{displayName}</p>
          <p className="mt-1 text-xs text-ink-3">{user?.profileName ?? roleLabel(user?.role ?? signedIn.role)}</p>
          <div className="mt-4 flex w-full flex-col gap-2">
            <Button variant="outline" disabled={busy || !user} icon={<Upload aria-hidden className="size-4" />} onClick={() => gallery.current?.click()}>Escolher foto</Button>
            <Button variant="ghost" disabled={busy || !user} icon={<Camera aria-hidden className="size-4" />} onClick={() => camera.current?.click()}>Usar câmera</Button>
            {image && <Button variant="ghost" disabled={busy} className="text-stop hover:text-stop" icon={<Trash2 aria-hidden className="size-3.5" />} onClick={() => { setPhoto(null); setSaved(null); }}>Remover foto</Button>}
          </div>
          <input ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Foto do perfil" onChange={(e) => void pick(e.target.files?.[0])} />
          <input ref={camera} type="file" accept="image/jpeg,image/png,image/webp" capture="user" className="sr-only" aria-label="Tirar foto do perfil" onChange={(e) => void pick(e.target.files?.[0])} />
          <p className="mt-3 text-[11px] text-ink-3">JPG, PNG ou WebP · até 5 MB.<br />A alteração é aplicada ao salvar.</p>
        </div>
      </PanelCard>
      <div className="space-y-4">
        <PanelCard>
          <SectionTitle>Dados pessoais</SectionTitle>
          <div className="space-y-4">
            <Field label="Nome" optional hint="Se deixar em branco, o nome atual é mantido."><input className={inputCls} value={name} maxLength={80} autoComplete="name" onChange={(e) => { setName(e.target.value); setSaved(null); }} /></Field>
            <Field label="E-mail de acesso" hint="O administrador pode alterar o e-mail em Admin → Usuários."><input className={cn(inputCls, "bg-paper-deep/40")} value={user?.email ?? signedIn.email} readOnly autoComplete="email" /></Field>
            <Field label="Breve descrição" optional hint={`${bio.length}/280 caracteres`}><textarea className={cn(inputCls, "h-24 resize-none py-2.5")} value={bio} maxLength={280} placeholder="Ex.: responsável pelo turno da manhã" onChange={(e) => { setBio(e.target.value); setSaved(null); }} /></Field>
          </div>
        </PanelCard>
        <PanelCard>
          <SectionTitle>Alterar senha · opcional</SectionTitle>
          <p className="mb-3 flex items-start gap-2 text-xs text-ink-3"><Lock aria-hidden className="mt-px size-3.5 shrink-0" />Para definir uma nova senha, confirme a atual. As outras sessões serão encerradas.</p>
          <div className="space-y-3">
            <Field label="Senha atual"><input className={inputCls} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required={!!newPassword} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nova senha"><input className={inputCls} type="password" autoComplete="new-password" value={newPassword} minLength={8} maxLength={128} placeholder="8 ou mais caracteres" onChange={(e) => setNewPassword(e.target.value)} /></Field>
              <Field label="Confirmar nova senha"><input className={inputCls} type="password" autoComplete="new-password" value={confirmPassword} maxLength={128} required={!!newPassword} onChange={(e) => setConfirmPassword(e.target.value)} /></Field>
            </div>
          </div>
        </PanelCard>
        <ErrorNote>{error}</ErrorNote>
        {saved && <p role="status" className="flex items-start gap-2 rounded-lg bg-ok-soft p-3 text-sm text-ok"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />{saved}</p>}
        <div className="flex justify-end"><Button type="submit" variant="hivis" loading={busy} disabled={!user} icon={<Save aria-hidden className="size-4" />}>Salvar perfil</Button></div>
      </div>
    </form>
  </div></div>;
}
