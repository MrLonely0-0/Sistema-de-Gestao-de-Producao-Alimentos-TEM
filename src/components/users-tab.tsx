"use client";

import { useState, type FormEvent } from "react";
import { Crown, KeyRound, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useUpdateAuth } from "@/components/auth-provider";
import { UserAvatar } from "@/components/user-avatar";
import {
  isAnyAdmin,
  isMasterAdmin,
  isReadOnly,
  ROLES,
  ROLE_LABEL,
  roleLabel,
  type AccessProfileDTO,
  type AdminUserDTO,
  type Role,
  type SessionUser,
} from "@/lib/domain";
import { api, errMsg } from "@/lib/client";
import { Button, cn, ErrorNote, Field, inputCls, Modal, SectionTitle, Switch, useToast } from "@/components/ui";

type Dialog = { kind: "new" } | { kind: "edit" | "password" | "delete"; user: AdminUserDTO } | null;

export function UsersTab({ users, profiles, me, onChanged }: {
  users: AdminUserDTO[];
  profiles: AccessProfileDTO[];
  me: SessionUser;
  onChanged: () => Promise<void>;
}) {
  const toast = useToast();
  const updateAuth = useUpdateAuth();
  const readOnly = isReadOnly(me.role);
  const meMaster = isMasterAdmin(me.role);
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filtered = users.filter((u) => `${u.name} ${u.email} ${u.profileName ?? roleLabel(u.role)}`.toLowerCase().includes(query.trim().toLowerCase()));
  function open(next: Dialog) { setError(null); setDialog(next); }

  async function mutate(fn: () => Promise<unknown>, message: string) {
    if (readOnly) return;
    setBusy(true); setError(null);
    try {
      await fn();
      await onChanged();
      const current = await api<{ user: SessionUser | null }>("/api/auth/me");
      if (current.user) updateAuth(current.user);
      setDialog(null); toast(message);
    } catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <SectionTitle>Usuários do sistema</SectionTitle>
        <p className="text-xs text-ink-3">
          Edite nome, e-mail e acesso. Exclusões encerram sessões e preservam o histórico.
          {!meMaster && !readOnly && " Contas de administrador e Master são protegidas e só podem ser editadas pelo Administrador Master."}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" icon={<RefreshCw aria-hidden className="size-3.5" />} onClick={() => void onChanged()}>Atualizar</Button>
        <Button variant="hivis" icon={<Plus aria-hidden className="size-4" />} onClick={() => open({ kind: "new" })}>Novo usuário</Button>
      </div>
    </div>
    <label className="relative block max-w-sm"><Search aria-hidden className="pointer-events-none absolute left-3 top-3.5 size-4 text-ink-3" /><span className="sr-only">Buscar usuários</span><input className={cn(inputCls, "pl-9")} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nome, e-mail ou perfil" /></label>
    <div className="overflow-x-auto rounded-xl border border-line bg-card">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-paper-deep/60 text-[11px] uppercase tracking-wide text-ink-3"><tr>{["Usuário", "Perfil de acesso", "Situação", "Ações"].map((h) => <th key={h} scope="col" className="px-3 py-3 font-bold">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-line">{filtered.map((u) => {
          const targetProtected = !meMaster && isAnyAdmin(u.role);
          const editDisabled = !readOnly && targetProtected;
          const deleteDisabled = u.id === me.id || (!readOnly && targetProtected);
          return <tr key={u.id} className={cn("transition hover:bg-paper-deep/25", !u.active && "text-ink-3")}>
            <td className="px-3 py-3">
              <div className="flex items-center gap-2.5">
                <UserAvatar name={u.name} url={u.avatarUrl} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {u.name}
                    {u.role === "admin_master" && (
                      <span className="inline-flex items-center gap-1 rounded bg-ink px-1.5 py-0.5 text-[10px] uppercase text-hivis">
                        <Crown aria-hidden className="size-3" /> Master
                      </span>
                    )}
                    {u.id === me.id && <span className="rounded bg-paper-deep px-1.5 py-0.5 text-[10px] uppercase text-ink-2">você</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-3">{u.email}</p>
                </div>
              </div>
            </td>
            <td className="px-3 py-3 text-[13px]">{u.profileName ?? roleLabel(u.role)}</td>
            <td className="px-3 py-3"><span className={cn("rounded-full px-2 py-1 text-[11px] font-bold uppercase", u.active ? "bg-ok-soft text-ok" : "bg-paper-deep text-ink-3")}>{u.active ? "Ativo" : "Inativo"}</span></td>
            <td className="px-3 py-3"><div className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={editDisabled} title={editDisabled ? "Apenas o Administrador Master pode editar esta conta." : undefined} aria-label={`Editar usuário ${u.name}`} icon={<Pencil aria-hidden className="size-3.5" />} onClick={() => open({ kind: "edit", user: u })}>Editar</Button>
              <Button size="sm" variant="ghost" disabled={editDisabled} title={editDisabled ? "Apenas o Administrador Master pode redefinir esta senha." : undefined} aria-label={`Redefinir senha de ${u.name}`} icon={<KeyRound aria-hidden className="size-3.5" />} onClick={() => open({ kind: "password", user: u })}>Senha</Button>
              <Button size="sm" variant="ghost" className="text-stop hover:bg-stop-soft hover:text-stop" disabled={deleteDisabled} title={u.id === me.id ? "Você não pode excluir a própria conta." : editDisabled ? "Apenas o Administrador Master pode excluir esta conta." : "Excluir conta"} aria-label={`Excluir usuário ${u.name}`} icon={<Trash2 aria-hidden className="size-3.5" />} onClick={() => open({ kind: "delete", user: u })}>Excluir</Button>
            </div></td>
          </tr>;
        })}{!filtered.length && <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-3">Nenhum usuário encontrado.</td></tr>}</tbody>
      </table>
    </div>
    <p className="text-xs text-ink-3">{users.length} conta(s). Não é permitido excluir a própria conta ou remover o último Administrador Master ativo.</p>
    {(dialog?.kind === "new" || dialog?.kind === "edit") && <UserForm
      user={dialog.kind === "edit" ? dialog.user : undefined} isMe={dialog.kind === "edit" && dialog.user.id === me.id} meMaster={meMaster} readOnly={readOnly} profiles={profiles}
      busy={busy} error={error} onClose={() => setDialog(null)}
      onSave={(body) => void mutate(() => api("/api/admin/users", { method: dialog.kind === "new" ? "POST" : "PATCH", body }), dialog.kind === "new" ? "Usuário criado." : "Dados e acesso do usuário atualizados.")}
    />}
    {dialog?.kind === "password" && <PasswordDialog name={dialog.user.name} readOnly={readOnly} busy={busy} error={error} onClose={() => setDialog(null)}
      onSave={(password) => void mutate(() => api("/api/admin/users", { method: "PATCH", body: { id: dialog.user.id, password } }), "Senha redefinida. As outras sessões dessa conta foram encerradas.")}
    />}
    {dialog?.kind === "delete" && <Modal eyebrow="Admin · confirmação" title={`Excluir ${dialog.user.name}?`} onClose={() => setDialog(null)} width="max-w-lg"
      footer={<><Button variant="ghost" onClick={() => setDialog(null)} disabled={busy}>Cancelar</Button><Button variant="danger" loading={busy} disabled={readOnly} onClick={() => void mutate(() => api(`/api/admin/users?id=${dialog.user.id}`, { method: "DELETE" }), "Usuário excluído e desconectado.")}>Excluir usuário</Button></>}>
      <div className="space-y-3">
        {readOnly && <p className="rounded-lg bg-qual-soft px-3 py-2 text-xs font-medium text-qual">Modo visualização (somente leitura): a exclusão está desabilitada.</p>}
        <p className="rounded-lg border border-line bg-card p-3 text-sm font-semibold">{dialog.user.email}</p>
        <p className="text-sm leading-relaxed text-ink-2">A conta sairá da lista, não poderá mais entrar e todas as suas sessões serão encerradas. As bateladas, conversas e registros feitos por ela continuarão no histórico.</p>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>}
  </div>;
}

function UserForm({ user, isMe, meMaster, readOnly, profiles, busy, error, onClose, onSave }: {
  user?: AdminUserDTO; isMe: boolean; meMaster: boolean; readOnly: boolean; profiles: AccessProfileDTO[]; busy: boolean; error: string | null; onClose: () => void; onSave: (body: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "producao");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");
  const allowedRoles = ROLES.filter((r) => meMaster || readOnly || !isAnyAdmin(r) || r === user?.role);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    onSave(user ? { id: user.id, name, email, active, ...(role !== user.role ? { role } : {}) } : { name, email, role, password });
  }
  return <Modal eyebrow="Admin · usuários" title={user ? "Editar usuário" : "Novo usuário"} onClose={onClose} width="max-w-lg"
    footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" form="admin-user-form" loading={busy} disabled={readOnly || name.trim().length < 2 || !email.trim() || (!user && password.length < 8)}>{user ? "Salvar alterações" : "Criar usuário"}</Button></>}>
    <form id="admin-user-form" onSubmit={submit} className="space-y-4">
      {readOnly && <p className="rounded-lg bg-qual-soft px-3 py-2 text-xs font-medium text-qual">Modo visualização (somente leitura): alterações não podem ser salvas.</p>}
      <Field label="Nome"><input className={inputCls} value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
      <Field label="E-mail" hint={user ? "Este será o e-mail usado no próximo login. As outras sessões da conta serão encerradas se o e-mail mudar." : undefined}><input className={inputCls} type="email" value={email} maxLength={254} required onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
      <Field label="Perfil de acesso"><select className={inputCls} value={role} disabled={isMe} onChange={(e) => setRole(e.target.value as Role)}>
        {allowedRoles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        {profiles.filter((p) => p.active || `custom:${p.id}` === user?.role).map((p) => <option key={p.id} value={`custom:${p.id}`} disabled={!p.active}>{p.name}{!p.active ? " (inativo)" : ""}</option>)}
      </select></Field>
      {!user && <Field label="Senha inicial"><input className={inputCls} type="password" value={password} minLength={8} maxLength={128} required autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} /></Field>}
      {user && <Switch checked={active} label="Acesso do usuário ativo" disabled={isMe} onChange={setActive} />}
      {isMe && <p className="text-xs text-ink-3">Você pode editar seu nome e e-mail, mas não remover o próprio acesso de administrador.</p>}
      <ErrorNote>{error}</ErrorNote>
    </form>
  </Modal>;
}

function PasswordDialog({ name, readOnly, busy, error, onClose, onSave }: { name: string; readOnly: boolean; busy: boolean; error: string | null; onClose: () => void; onSave: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return <Modal eyebrow={`Usuário · ${name}`} title="Redefinir senha" onClose={onClose} width="max-w-md" footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button><Button type="submit" form="reset-password-form" loading={busy} disabled={readOnly || password.length < 8}>Redefinir senha</Button></>}>
    <form id="reset-password-form" onSubmit={(e) => { e.preventDefault(); if (!readOnly) onSave(password); }} className="space-y-3">
      {readOnly && <p className="rounded-lg bg-qual-soft px-3 py-2 text-xs font-medium text-qual">Modo visualização (somente leitura): redefinição de senha desabilitada.</p>}
      <Field label="Nova senha" hint="Use pelo menos 8 caracteres. As outras sessões dessa conta serão encerradas."><input className={inputCls} type="password" autoComplete="new-password" value={password} minLength={8} maxLength={128} onChange={(e) => setPassword(e.target.value)} required /></Field>
      <ErrorNote>{error}</ErrorNote>
    </form>
  </Modal>;
}
