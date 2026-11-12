"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Check, Folder, KeyRound, Layers, Package, Users } from "lucide-react";
import {
  ACTION_LABEL,
  can,
  ROLE_LABEL,
  ROLES,
  type Action,
  type AdminOverviewDTO,
  type AdminUserDTO,
  type ProductDTO,
  type Role,
  type SessionUser,
  AccessProfileDTO,
  GrantableAction,
  GRANTABLE_ACTIONS,
  GRANT_LABEL,
} from "@/lib/domain";
import { api, errMsg, fmtShort } from "@/lib/client";
import {
  Button,
  cn,
  ErrorNote,
  Field,
  inputCls,
  PanelCard as Card,
  SectionTitle,
  Switch,
  useToast,
} from "@/components/ui";
import { ProductsTab } from "@/components/products-tab";
import { ColumnsTab } from "@/components/columns-tab";

type Tab = "produtos" | "painéis" | "usuarios" | "drive";
type Run = (fn: () => Promise<unknown>, okMessage?: string) => Promise<boolean>;

const TABS: Array<{ id: Tab; label: string; icon: typeof Package }> = [
  { id: "produtos", label: "Produtos e classificações", icon: Package },
  { id: "painéis", label: "Painéis do quadro", icon: Layers },
  { id: "usuarios", label: "Usuários e perfis", icon: Users },
  { id: "drive", label: "Google Drive", icon: Folder },
];

export function AdminPanel({ me }: { me: SessionUser }) {
  const toast = useToast();
  const [data, setData] = useState<AdminOverviewDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("produtos");

  const load = useCallback(async () => {
    try {
      setData(await api<AdminOverviewDTO>("/api/admin"));
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run: Run = useCallback(
    async (fn, okMessage) => {
      try {
        await fn();
        if (okMessage) toast(okMessage);
        await load();
        return true;
      } catch (e) {
        toast(errMsg(e), "error");
        return false;
      }
    },
    [load, toast],
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-3 pb-12 pt-5 sm:px-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">
          Gestão
        </p>
        <h1 className="display mt-1.5 text-[34px]">Painel Admin</h1>

        <div
          role="tablist"
          aria-label="Seções do painel"
          className="mt-5 flex gap-1.5 overflow-x-auto border-b border-ink/15 pb-px"
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`panel-${id}`}
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px flex h-11 shrink-0 items-center gap-2 border-b-[3px] px-3 text-sm font-semibold transition",
                tab === id
                  ? "border-ink text-ink"
                  : "border-transparent text-ink-3 hover:text-ink",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id={`panel-${tab}`}
          aria-labelledby={`tab-${tab}`}
          className="mt-5"
        >
          {error && !data && <ErrorNote>{error}</ErrorNote>}
          {!data && !error && (
            <div aria-hidden className="space-y-3">
              <div className="h-28 animate-pulse rounded-xl bg-ink/8" />
              <div className="h-52 animate-pulse rounded-xl bg-ink/8" />
            </div>
          )}
          {data && tab === "produtos" && (
            <ProductsTab
              products={data.products}
              dimensions={data.dimensions}
              run={run}
            />
          )}
          {data && tab === "painéis" && (
            <ColumnsTab columns={data.columns} run={run} />
          )}
          {data && tab === "usuarios" && (
            <UsersTab
              users={data.users}
              profiles={data.profiles}
              chatTitle={data.chatTitle}
              me={me}
              run={run}
            />
          )}
          {data && tab === "drive" && <DriveTab drive={data.drive} />}
        </div>
      </div>
    </div>
  );
}

/* ───────────── Usuários e RBAC ───────────── */

const MATRIX: Action[] = [
  "criar",
  "editar",
  "marcar_pronto",
  "liberar",
  "reter",
  "devolver",
  "finalizar",
  "separar",
];

/** Valor do seletor: "r:<papel>" para papel padrão, "p:<id>" para perfil personalizado. */
function accessValue(user: { role: Role; profileId: number | null }) {
  return user.profileId ? `p:${user.profileId}` : `r:${user.role}`;
}
function accessOptions(profiles: AccessProfileDTO[]) {
  return [
    ...ROLES.map((r) => ({ value: `r:${r}`, label: ROLE_LABEL[r] })),
    ...profiles
      .filter((p) => p.active)
      .map((p) => ({ value: `p:${p.id}`, label: `${p.name} (personalizado)` })),
  ];
}

function UsersTab({
  users,
  profiles,
  chatTitle,
  me,
  run,
}: {
  users: AdminUserDTO[];
  profiles: AccessProfileDTO[];
  chatTitle: string;
  me: SessionUser;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [access, setAccess] = useState("r:producao");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const isProfile = access.startsWith("p:");
    const body = isProfile
      ? { name, email, password, profileId: Number(access.slice(2)) }
      : { name, email, password, role: access.slice(2) as Role };
    const label =
      accessOptions(profiles).find((o) => o.value === access)?.label ?? "";
    const ok = await run(
      () => api("/api/admin/users", { method: "POST", body }),
      `Usuário ${name.trim()} criado: ${label}.`,
    );
    setBusy(false);
    if (ok) {
      setName("");
      setEmail("");
      setPassword("");
    }
  }

  return (
    <div className="space-y-6">
      <ChatTitleCard initial={chatTitle} run={run} />
      <ProfilesCard profiles={profiles} run={run} />
      <Card>
        <SectionTitle>Novo usuário</SectionTitle>
        <form
          onSubmit={create}
          className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.4fr_1.2fr_1fr_auto]"
        >
          <Field label="Nome">
            <input
              className={inputCls}
              value={name}
              maxLength={80}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="E-mail">
            <input
              className={inputCls}
              type="email"
              value={email}
              autoComplete="off"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Perfil de acesso">
            <select
              className={inputCls}
              value={access}
              onChange={(e) => setAccess(e.target.value)}
            >
              {accessOptions(profiles).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Senha inicial">
            <input
              className={inputCls}
              type="text"
              value={password}
              autoComplete="off"
              placeholder="8+ caracteres"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            loading={busy}
            disabled={
              name.trim().length < 2 ||
              !email.includes("@") ||
              password.length < 8
            }
          >
            Criar
          </Button>
        </form>
      </Card>

      <section>
        <SectionTitle>Usuários ({users.length})</SectionTitle>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
          {users.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              profiles={profiles}
              isMe={u.id === me.id}
              run={run}
            />
          ))}
        </ul>
      </section>

      <section>
        <SectionTitle>Matriz de permissões</SectionTitle>
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[640px] text-left text-[13px]">
            <thead className="bg-paper-deep/60 text-[11px] uppercase tracking-wide text-ink-3">
              <tr>
                <th scope="col" className="px-3 py-2.5 font-bold">
                  Ação
                </th>
                {ROLES.map((r) => (
                  <th
                    key={r}
                    scope="col"
                    className="px-2 py-2.5 text-center font-bold"
                  >
                    {ROLE_LABEL[r]
                      .replace("Operador de ", "")
                      .replace("Inspetor de ", "")
                      .replace("Estoque e ", "")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <th scope="row" className="px-3 py-2.5 font-semibold">
                  Ver o painel completo
                </th>
                {ROLES.map((r) => (
                  <td key={r} className="px-2 py-2.5 text-center">
                    <Mark on />
                  </td>
                ))}
              </tr>
              {MATRIX.map((action) => (
                <tr key={action}>
                  <th scope="row" className="px-3 py-2.5 font-semibold">
                    {ACTION_LABEL[action]}
                  </th>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2 py-2.5 text-center">
                      <Mark on={can(r, action)} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-3 py-2.5 font-semibold">
                  Painel Admin (produtos, usuários, Drive)
                </th>
                {ROLES.map((r) => (
                  <td key={r} className="px-2 py-2.5 text-center">
                    <Mark on={r === "admin"} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          As permissões são verificadas no servidor a cada ação — esconder o
          botão na tela é só conveniência. Anexos: a Qualidade anexa em qualquer
          etapa; Produção e Acabamento, enquanto o card está na sua coluna.
        </p>
      </section>
    </div>
  );
}

function Mark({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-grid size-6 place-items-center rounded-full bg-ok-soft text-ok">
      <Check aria-hidden className="size-3.5" strokeWidth={3} />
      <span className="sr-only">Permitido</span>
    </span>
  ) : (
    <span className="text-ink/25">
      <span aria-hidden>—</span>
      <span className="sr-only">Não permitido</span>
    </span>
  );
}

function UserRow({
  user,
  profiles,
  isMe,
  run,
}: {
  user: AdminUserDTO;
  profiles: AccessProfileDTO[];
  isMe: boolean;
  run: Run;
}) {
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const patch = (body: Record<string, unknown>, ok?: string) =>
    run(
      () =>
        api("/api/admin/users", {
          method: "PATCH",
          body: { id: user.id, ...body },
        }),
      ok,
    );

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await patch({ password }, `Senha de ${user.name} redefinida.`);
    setBusy(false);
    if (ok) {
      setPassword("");
      setResetting(false);
    }
  }

  return (
    <li className={cn("px-3 py-3", !user.active && "bg-paper-deep/50")}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-44 flex-1">
          <p
            className={cn(
              "text-sm font-semibold",
              !user.active && "text-ink-3",
            )}
          >
            {user.name}
            {isMe && (
              <span className="ml-2 rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold uppercase text-hivis">
                você
              </span>
            )}
          </p>
          <p className="truncate text-xs text-ink-3">{user.email}</p>
        </div>
        <div className="w-full shrink-0 sm:w-60">
          <select
            className={inputCls}
            aria-label={`Perfil de ${user.name}`}
            value={accessValue(user)}
            disabled={isMe}
            onChange={(e) => {
              const v = e.target.value;
              const label =
                accessOptions(profiles).find((o) => o.value === v)?.label ?? "";
              void patch(
                v.startsWith("p:")
                  ? { profileId: Number(v.slice(2)) }
                  : { role: v.slice(2) },
                `${user.name} agora usa: ${label}.`,
              );
            }}
          >
            {accessOptions(profiles).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <Switch
          checked={user.active}
          disabled={isMe}
          label={`Acesso de ${user.name} ativo`}
          onChange={(active) =>
            void patch(
              { active },
              active
                ? `${user.name} reativado.`
                : `${user.name} desativado e desconectado.`,
            )
          }
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<KeyRound aria-hidden className="size-3.5" />}
          onClick={() => setResetting((v) => !v)}
        >
          Senha
        </Button>
      </div>
      {resetting && (
        <form
          onSubmit={savePassword}
          className="mt-2.5 flex flex-wrap items-center gap-2"
        >
          <input
            className={cn(inputCls, "max-w-64")}
            aria-label={`Nova senha de ${user.name}`}
            placeholder="Nova senha (8+ caracteres)"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button
            type="submit"
            size="sm"
            loading={busy}
            disabled={password.length < 8}
          >
            Redefinir
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setResetting(false)}>
            Cancelar
          </Button>
        </form>
      )}
    </li>
  );
}

/* ───────────── Google Drive (simulado) ───────────── */

function DriveTab({ drive }: { drive: AdminOverviewDTO["drive"] }) {
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded bg-ink px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-hivis">
            Modo simulado
          </span>
          <p className="text-sm font-semibold">
            Nenhuma chamada sai para o Google nesta versão.
          </p>
        </div>
        <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-ink-2">
          Cada batelada nova ganha uma pasta dedicada (ID e caminho gerados pelo
          sistema) e os links de laudos e fotos ficam guardados nela. A
          estrutura é a mesma que a integração real usaria, então trocar o modo
          simulado pela API do Drive não muda nada nas telas.
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-paper-deep/60 px-3 py-2.5">
            <dt className="text-xs text-ink-3">Pastas criadas</dt>
            <dd className="display tnum mt-1 text-[28px]">
              {drive.totalFolders}
            </dd>
          </div>
          <div className="rounded-lg bg-paper-deep/60 px-3 py-2.5">
            <dt className="text-xs text-ink-3">Links guardados</dt>
            <dd className="display tnum mt-1 text-[28px]">
              {drive.totalAttachments}
            </dd>
          </div>
          <div className="rounded-lg bg-paper-deep/60 px-3 py-2.5">
            <dt className="text-xs text-ink-3">Pasta raiz</dt>
            <dd className="mt-1.5 text-sm font-semibold">{drive.root}</dd>
          </div>
        </dl>
      </Card>

      <section>
        <SectionTitle>Pastas mais recentes</SectionTitle>
        {drive.folders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink/25 px-4 py-6 text-center text-sm text-ink-3">
            As pastas aparecem aqui conforme as bateladas são abertas.
          </p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
            {drive.folders.map((f) => (
              <li
                key={f.batchId}
                className="flex items-start gap-3 px-3 py-2.5"
              >
                <Folder
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-prod"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                    {f.path}
                  </p>
                  <p className="break-all font-mono text-[11px] text-ink-3">
                    ID {f.folderId}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-ink-3">
                  <p className="tnum font-semibold text-ink-2">
                    {f.attachments} {f.attachments === 1 ? "anexo" : "anexos"}
                  </p>
                  <p className="tnum">{fmtShort(f.createdAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Card>
        <SectionTitle>Para ligar o Drive de verdade</SectionTitle>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-2">
          <li>
            No Google Cloud, crie um projeto, ative a Drive API e gere uma conta
            de serviço (gratuito).
          </li>
          <li>
            Compartilhe a pasta raiz do Drive da empresa com o e-mail da conta
            de serviço, como Editor.
          </li>
          <li>
            Substitua a função{" "}
            <code className="rounded bg-paper-deep px-1 font-mono text-[13px]">
              createBatchFolder
            </code>{" "}
            em{" "}
            <code className="rounded bg-paper-deep px-1 font-mono text-[13px]">
              src/lib/drive.ts
            </code>{" "}
            pela chamada à API e guarde as credenciais em variáveis de ambiente.
            O passo a passo está no README.
          </li>
        </ol>
      </Card>
    </div>
  );
}

/* ───────────── Nome da aba de chat ───────────── */

function ChatTitleCard({ initial, run }: { initial: string; run: Run }) {
  const [title, setTitle] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setTitle(initial), [initial]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await run(
      () => api("/api/admin/chat-title", { method: "PATCH", body: { title } }),
      "Nome da aba de chat atualizado.",
    );
    setBusy(false);
  }
  return (
    <Card>
      <SectionTitle>Aba de chat da equipe</SectionTitle>
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <Field
            label="Nome exibido no menu"
            hint="Aparece na barra superior para todos os colaboradores."
          >
            <input
              className={inputCls}
              value={title}
              maxLength={30}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
        </div>
        <Button
          type="submit"
          loading={busy}
          disabled={title.trim().length < 2 || title.trim() === initial}
        >
          Salvar nome
        </Button>
      </form>
    </Card>
  );
}

/* ───────────── Perfis de acesso personalizados ───────────── */

const EMPTY_PROFILE = {
  id: 0,
  name: "",
  description: "",
  baseRole: "consulta" as Role,
  grants: [] as GrantableAction[],
  active: true,
};

function ProfilesCard({
  profiles,
  run,
}: {
  profiles: AccessProfileDTO[];
  run: Run;
}) {
  const [editing, setEditing] = useState<typeof EMPTY_PROFILE | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    const body = {
      name: editing.name.trim(),
      description: editing.description.trim(),
      baseRole: editing.baseRole,
      grants: editing.grants,
      active: editing.active,
    };
    const ok = await run(
      () =>
        api("/api/admin/profiles", {
          method: editing.id ? "PATCH" : "POST",
          body: editing.id ? { id: editing.id, ...body } : body,
        }),
      editing.id
        ? `Perfil ${body.name} atualizado.`
        : `Perfil ${body.name} criado.`,
    );
    setBusy(false);
    if (ok) setEditing(null);
  }

  async function remove(p: AccessProfileDTO) {
    if (
      !window.confirm(
        `Excluir o perfil "${p.name}"? ${p.userCount} usuário(s) mantêm o papel padrão e perdem as permissões extras.`,
      )
    )
      return;
    await run(
      () => api(`/api/admin/profiles?id=${p.id}`, { method: "DELETE" }),
      `Perfil ${p.name} excluído.`,
    );
  }

  const toggleGrant = (g: GrantableAction) =>
    setEditing((cur) =>
      cur
        ? {
            ...cur,
            grants: cur.grants.includes(g)
              ? cur.grants.filter((x) => x !== g)
              : [...cur.grants, g],
          }
        : cur,
    );

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Perfis de acesso personalizados</SectionTitle>
        {!editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing({ ...EMPTY_PROFILE })}
          >
            Novo perfil
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-ink-3">
        Um perfil personalizado parte de um papel padrão e acrescenta permissões
        de trabalho. Ex.: um operador de Produção que também pode liberar lotes.
      </p>

      {profiles.length === 0 && !editing && (
        <p className="text-sm text-ink-3">
          Nenhum perfil personalizado. Os papéis padrão continuam valendo.
        </p>
      )}

      <ul className="mb-3 divide-y divide-line">
        {profiles.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">
                {p.name}{" "}
                {!p.active && (
                  <span className="ml-1 text-xs font-normal text-ink-3">
                    (inativo)
                  </span>
                )}
              </p>
              <p className="text-xs text-ink-3">
                Base: {ROLE_LABEL[p.baseRole]} · {p.grants.length}{" "}
                permissão(ões) extra(s) · {p.userCount} usuário(s)
              </p>
              {p.grants.length > 0 && (
                <p className="mt-0.5 text-xs text-ink-2">
                  {p.grants.map((g) => GRANT_LABEL[g]).join(" · ")}
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setEditing({ ...p, description: p.description ?? "" })
              }
            >
              Editar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void remove(p)}>
              Excluir
            </Button>
          </li>
        ))}
      </ul>

      {editing && (
        <form
          onSubmit={save}
          className="space-y-3 rounded-lg border border-ink/20 bg-paper p-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome do perfil">
              <input
                className={inputCls}
                value={editing.name}
                maxLength={40}
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </Field>
            <Field
              label="Papel-base"
              hint="Define o que o perfil já pode ver e fazer."
            >
              <select
                className={inputCls}
                value={editing.baseRole}
                onChange={(e) =>
                  setEditing({ ...editing, baseRole: e.target.value as Role })
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Descrição" optional>
            <input
              className={inputCls}
              value={editing.description}
              maxLength={200}
              onChange={(e) =>
                setEditing({ ...editing, description: e.target.value })
              }
            />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-3">
              Permissões extras
            </legend>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {GRANTABLE_ACTIONS.map((g) => (
                <label key={g} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-ink"
                    checked={editing.grants.includes(g)}
                    onChange={() => toggleGrant(g)}
                  />
                  {GRANT_LABEL[g]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-ink"
              checked={editing.active}
              onChange={(e) =>
                setEditing({ ...editing, active: e.target.checked })
              }
            />
            Perfil ativo
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={busy}
              disabled={editing.name.trim().length < 2}
            >
              {editing.id ? "Salvar perfil" : "Criar perfil"}
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
