"use client";

import { useState, type FormEvent } from "react";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { ACTION_LABEL, isAnyAdmin, ROLE_LABEL, ROLES, type AccessProfileDTO, type Action } from "@/lib/domain";
import { api, errMsg } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal, PanelCard, SectionTitle, Switch } from "@/components/ui";
import type { Run } from "@/components/products-tab";

export function ProfilesTab({ profiles, readOnly = false, run }: { profiles: AccessProfileDTO[]; readOnly?: boolean; run: Run }) {
  const [editing, setEditing] = useState<AccessProfileDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<AccessProfileDTO | null>(null);
  const [replacement, setReplacement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true); setError(null);
    const done = await run(async () => {
      try { return await fn(); }
      catch (e) { setError(errMsg(e)); throw e; }
    }, message);
    setBusy(false);
    if (done) { setEditing(null); setDeleting(null); }
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><SectionTitle>Perfis personalizados</SectionTitle><p className="max-w-2xl text-xs text-ink-3">Crie, edite ou exclua perfis. Ao excluir um perfil em uso, escolha o acesso que seus usuários receberão. Os perfis padrão do fluxo são mantidos pelo sistema.</p></div>
      <Button variant="hivis" icon={<Plus aria-hidden className="size-4" />} onClick={() => { setError(null); setEditing("new"); }}>Novo perfil</Button>
    </div>
    <div className="grid gap-3 md:grid-cols-2">{profiles.map((p) => <PanelCard key={p.id} className={cn(!p.active && "bg-paper-deep/50")}>
      <div className="flex items-start justify-between gap-2"><div><h3 className="flex items-center gap-2 text-[17px] font-bold"><ShieldCheck aria-hidden className="size-4 text-prod" />{p.name}</h3><p className="mt-1 text-xs text-ink-3">{p.description || "Sem descrição"}</p><p className="mt-1 text-xs text-ink-3">{p.userCount} usuário(s) · {p.permissions.length} permissões</p></div>
        <div className="flex flex-col gap-1 sm:flex-row"><Button size="sm" variant="outline" aria-label={`Editar perfil ${p.name}`} icon={<Pencil aria-hidden className="size-3.5" />} onClick={() => { setError(null); setEditing(p); }}>Editar</Button><Button size="sm" variant="ghost" className="text-stop hover:bg-stop-soft hover:text-stop" aria-label={`Excluir perfil ${p.name}`} icon={<Trash2 aria-hidden className="size-3.5" />} onClick={() => { setReplacement(""); setError(null); setDeleting(p); }}>Excluir</Button></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">{p.permissions.length ? p.permissions.map((a) => <span key={a} className="rounded bg-ok-soft px-1.5 py-0.5 text-[11px] font-semibold text-ok">{ACTION_LABEL[a]}</span>) : <span className="text-xs text-ink-3">Somente leitura e conversa.</span>}</div>
      <div className="mt-3 flex justify-end"><Switch checked={p.active} disabled={readOnly} label={`Perfil ${p.name} ativo`} onChange={(active) => void run(() => api("/api/admin/profiles", { method: "PATCH", body: { id: p.id, active } }), active ? "Perfil reativado." : "Perfil desativado. As sessões dos usuários vinculados foram encerradas.")} /></div>
    </PanelCard>)}</div>
    {!profiles.length && <p className="rounded-xl border border-dashed border-ink/25 px-4 py-6 text-center text-sm text-ink-3">Nenhum perfil personalizado. Os perfis padrão estão disponíveis em Usuários.</p>}
    {editing && <ProfileForm profile={editing === "new" ? undefined : editing} readOnly={readOnly} busy={busy} error={error} onClose={() => setEditing(null)} onSubmit={(body) => void action(() => api("/api/admin/profiles", { method: editing === "new" ? "POST" : "PATCH", body }), "Perfil salvo.")} />}
    {deleting && <Modal eyebrow="Admin · confirmação" title={`Excluir "${deleting.name}"?`} onClose={() => setDeleting(null)} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>Cancelar</Button><Button variant="danger" loading={busy} disabled={readOnly || (deleting.userCount > 0 && !replacement)} onClick={() => {
        const p = new URLSearchParams({ id: String(deleting.id) }); if (replacement) p.set("replacementRole", replacement);
        void action(() => api(`/api/admin/profiles?${p}`, { method: "DELETE" }), "Perfil excluído. Os acessos vinculados foram atualizados.");
      }}>Excluir perfil</Button></>}>
      <div className="space-y-4">
        {readOnly && <p className="rounded-lg bg-qual-soft px-3 py-2 text-xs font-medium text-qual">Modo visualização (somente leitura): a exclusão está desabilitada.</p>}
        <p className="text-sm leading-relaxed text-ink-2">Este perfil sairá do cadastro. {deleting.userCount > 0 ? `Os ${deleting.userCount} usuário(s) vinculados receberão o perfil escolhido abaixo e precisarão entrar novamente.` : "Não há usuários vinculados neste momento."} O histórico não será apagado.</p>
        <Field label="Transferir usuários para" optional={deleting.userCount === 0} hint="Escolha explicitamente o acesso substituto. Nenhum usuário recebe acesso de administrador automaticamente.">
          <select className={inputCls} value={replacement} onChange={(e) => setReplacement(e.target.value)}>
            <option value="">Selecione o perfil substituto</option>
            {ROLES.filter((r) => !isAnyAdmin(r)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            {profiles.filter((p) => p.active && p.id !== deleting.id).map((p) => <option key={p.id} value={`custom:${p.id}`}>{p.name}</option>)}
          </select>
        </Field>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>}
  </div>;
}

function ProfileForm({ profile, readOnly, busy, error, onClose, onSubmit }: { profile?: AccessProfileDTO; readOnly: boolean; busy: boolean; error: string | null; onClose: () => void; onSubmit: (body: Record<string, unknown>) => void }) {
  const [name, setName] = useState(profile?.name ?? "");
  const [description, setDescription] = useState(profile?.description ?? "");
  const [permissions, setPermissions] = useState<Action[]>(profile?.permissions ?? []);
  function submit(e: FormEvent) { e.preventDefault(); if (!readOnly) onSubmit({ ...(profile ? { id: profile.id } : {}), name, description, permissions }); }
  return <Modal eyebrow="Perfis de acesso" title={profile ? `Editar ${profile.name}` : "Novo perfil"} onClose={onClose} width="max-w-xl" footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" form="profile-form" loading={busy} disabled={readOnly || name.trim().length < 2}>Salvar perfil</Button></>}>
    <form id="profile-form" onSubmit={submit} className="space-y-4">
      {readOnly && <p className="rounded-lg bg-qual-soft px-3 py-2 text-xs font-medium text-qual">Modo visualização (somente leitura): alterações não podem ser salvas.</p>}
      <Field label="Nome do perfil"><input className={inputCls} autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Descrição" optional><input className={inputCls} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} /></Field>
      <SectionTitle>Ações permitidas</SectionTitle>
      <div className="grid gap-1.5 sm:grid-cols-2">{(Object.keys(ACTION_LABEL) as Action[]).map((a) => <label key={a} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-medium"><input type="checkbox" className="size-4 accent-ink" checked={permissions.includes(a)} onChange={() => setPermissions((cur) => cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a])} />{ACTION_LABEL[a]}</label>)}</div>
      <p className="text-xs text-ink-3">Alterar permissões encerra as sessões dos usuários vinculados para aplicar o acesso atualizado.</p>
      <ErrorNote>{error}</ErrorNote>
    </form>
  </Modal>;
}
