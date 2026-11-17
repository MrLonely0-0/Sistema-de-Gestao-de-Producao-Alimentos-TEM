/** Testes de contas, perfil pessoal e relatórios. Limpeza demo é testada com ROLLBACK. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import sharp from "sharp";
import { db, pool } from "../src/db";
import * as S from "../src/db/schema";
import { ApiError } from "../src/lib/api";
import { ensureAnotherMasterAdmin } from "../src/lib/access-control";
import { clearDemoInTransaction, demoPreviewInTransaction } from "../src/lib/demo-service";
import { stockBalance } from "../src/lib/inventory-ledger";
import { ensureReady } from "../src/lib/seed";
import type { AdminOverviewDTO, MyProfileDTO, ReportsDTO, SessionUser, StockManageDTO } from "../src/lib/domain";

const B = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const suffix = randomBytes(5).toString("hex");
const oldPassword = randomBytes(18).toString("hex");
const newPassword = randomBytes(18).toString("hex");
const users: number[] = [], profiles: number[] = [];
let productId: number | undefined;
let tests = 0;
const ok = (text: string) => { tests++; console.log(`✓ ${text}`); };
async function call<T = Record<string, unknown>>(path: string, token = "", method = "GET", body?: unknown, expected = 200): Promise<T> {
  const res = await fetch(B + path, { method, headers: { "content-type": "application/json", "x-tem-client": "1", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json(); assert.equal(res.status, expected, `${method} ${path}: ${JSON.stringify(data)}`); return data as T;
}
async function login(email: string, password: string) { return (await call<{ token: string }>("/api/auth/login", "", "POST", { email, password })).token; }
class Rollback extends Error {}

async function main() {
  const salt = randomBytes(16).toString("hex");
  const adminEmail = `admin-${suffix}@account.test`;
  const [admin] = await db.insert(S.users).values({ name: "Validação contas", email: adminEmail, role: "admin_master", passwordHash: `scrypt$${salt}$${scryptSync(oldPassword, salt, 64).toString("hex")}` }).returning();
  users.push(admin.id);
  const token = await login(adminEmail, oldPassword);
  const actor: SessionUser = { id: admin.id, name: admin.name, email: adminEmail, role: "admin_master" };
  const profileName = `Apoio-${suffix}`;
  const profile = await call<{ id: number }>("/api/admin/profiles", token, "POST", { name: profileName, permissions: ["criar"] }); profiles.push(profile.id);
  const initialEmail = `worker-${suffix}@account.test`;
  const created = await call<{ id: number }>("/api/admin/users", token, "POST", { name: "Colaborador QA", email: initialEmail, password: oldPassword, role: `custom:${profile.id}` }); users.push(created.id);
  const worker = await login(initialEmail, oldPassword);
  const secondSession = await login(initialEmail, oldPassword);
  await call("/api/account", "", "GET", undefined, 401);
  const photo = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#3874a1" } }).png().toBuffer();
  const result = await call<{ user: MyProfileDTO }>("/api/account", worker, "PATCH", { name: "Nome atualizado QA", bio: "Turno da manhã", photoData: `data:image/png;base64,${photo.toString("base64")}` });
  assert.equal(result.user.name, "Nome atualizado QA"); assert.equal(result.user.bio, "Turno da manhã"); assert.ok(result.user.avatarUrl);
  assert.ok(!JSON.stringify(result).includes("passwordHash"));
  const image = await fetch(B + result.user.avatarUrl, { headers: { authorization: `Bearer ${worker}` } });
  assert.equal(image.status, 200); assert.equal(image.headers.get("content-type"), "image/webp");
  const meta = await sharp(Buffer.from(await image.arrayBuffer())).metadata(); assert.equal(meta.width, 256); assert.equal(meta.height, 256);
  assert.equal((await fetch(B + result.user.avatarUrl)).status, 401);
  ok("Nome, descrição e foto persistem; avatar é protegido e sem hash de senha na resposta");

  await call("/api/account", worker, "PATCH", { photoData: `data:image/png;base64,${Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>").toString("base64")}` }, 400);
  await call("/api/account", worker, "PATCH", { role: "admin" }, 400);
  await call("/api/account", worker, "PATCH", { email: "outro@account.test" }, 400);
  await call("/api/admin/users", worker, "DELETE", undefined, 403);
  await call("/api/admin/profiles?id=" + profile.id, worker, "DELETE", undefined, 403);
  await call("/api/admin/data", worker, "POST", { confirmation: "LIMPAR DEMONSTRAÇÃO", version: "x".repeat(64) }, 403);
  ok("Usuário comum não altera privilégios/e-mail nem exclui usuários, perfis ou dados");

  await call("/api/account", worker, "PATCH", { currentPassword: "errada", newPassword, confirmPassword: newPassword }, 400);
  await call("/api/account", worker, "PATCH", { currentPassword: oldPassword, newPassword, confirmPassword: "diferente" }, 400);
  await call("/api/account", worker, "PATCH", { currentPassword: oldPassword, newPassword, confirmPassword: newPassword });
  await call("/api/account", worker);
  await call("/api/account", secondSession, "GET", undefined, 401);
  await call("/api/auth/login", "", "POST", { email: initialEmail, password: oldPassword }, 401);
  ok("Troca de senha exige a atual/confirmada, mantém a sessão atual e revoga as demais");

  const newEmail = `novo-${suffix}@account.test`;
  await call("/api/admin/users", token, "PATCH", { id: created.id, email: newEmail });
  await call("/api/account", worker, "GET", undefined, 401);
  await call("/api/auth/login", "", "POST", { email: initialEmail, password: newPassword }, 401);
  let liveWorker = await login(newEmail, newPassword);
  await call("/api/admin/users", token, "PATCH", { id: created.id, email: adminEmail }, 409);
  const reloaded = await call<{ user: MyProfileDTO }>("/api/account", liveWorker);
  assert.equal(reloaded.user.email, newEmail); assert.equal(reloaded.user.bio, "Turno da manhã");
  ok("Admin altera e-mail; antigo deixa de entrar e e-mails duplicados são recusados");

  await call(`/api/admin/profiles?id=${profile.id}`, token, "DELETE", undefined, 409);
  await call("/api/admin/profiles", token, "PATCH", { id: profile.id, active: false });
  await call("/api/account", liveWorker, "GET", undefined, 401);
  await call("/api/auth/login", "", "POST", { email: newEmail, password: newPassword }, 403);
  await call("/api/admin/profiles", token, "PATCH", { id: profile.id, active: true });
  await call("/api/account", liveWorker, "GET", undefined, 401);
  liveWorker = await login(newEmail, newPassword);
  await call(`/api/admin/profiles?id=${profile.id}&replacementRole=producao`, token, "DELETE");
  await call("/api/account", liveWorker, "GET", undefined, 401);
  liveWorker = await login(newEmail, newPassword);
  const transferred = await call<{ user: MyProfileDTO }>("/api/account", liveWorker);
  assert.equal(transferred.user.role, "producao");
  const overview = await call<AdminOverviewDTO>("/api/admin", token);
  assert.ok(!overview.profiles.some((p) => p.id === profile.id));
  ok("Perfil em uso pode ser excluído com transferência; sessões e desativação são respeitadas");

  const removedPhoto = await call<{ user: MyProfileDTO }>("/api/account", liveWorker, "PATCH", { photoData: null, bio: "" });
  assert.equal(removedPhoto.user.avatarUrl, null); assert.equal(removedPhoto.user.bio, null);
  ok("Foto e descrição opcionais podem ser removidas");

  const brand = `QA-${suffix}`;
  productId = (await call<{ id: number }>("/api/admin/products", token, "POST", { brand, format: "750 g" })).id;
  const batch = await call<{ id: number }>("/api/batches", liveWorker, "POST", { productId });
  await call("/api/stock/items", token, "POST", { productId, newPackaging: { label: "Caixa", unitsPerBox: 12 }, balance: 5 });
  let stock = await call<StockManageDTO>("/api/stock", token);
  const item = stock.rows.find((r) => r.productId === productId)!; assert.ok(item);
  await call(`/api/admin/users?id=${admin.id}`, token, "DELETE", undefined, 400);
  await call(`/api/admin/users?id=${created.id}`, token, "DELETE");
  await call("/api/account", liveWorker, "GET", undefined, 401);
  await call("/api/auth/login", "", "POST", { email: newEmail, password: newPassword }, 401);
  const afterDelete = await call<AdminOverviewDTO>("/api/admin", token); assert.ok(!afterDelete.users.some((u) => u.id === created.id));
  const [historical] = await db.select().from(S.batches).where(eq(S.batches.id, batch.id));
  assert.equal(historical.createdById, created.id); assert.equal(historical.createdByName, "Nome atualizado QA");
  const another = await call<{ id: number }>("/api/admin/users", token, "POST", { name: "Nova conta QA", email: newEmail, password: oldPassword, role: "producao" }); users.push(another.id);
  assert.notEqual(another.id, created.id);
  ok("Excluir usuário bloqueia o acesso, preserva autoria e libera e-mail para outra conta sem herdar sessões");

  // Proteção ao último administrador master, sem efetivar mudanças nas contas reais.
  try {
    await db.transaction(async (tx) => {
      await tx.update(S.users).set({ active: false }).where(and(eq(S.users.role, "admin_master"), ne(S.users.id, admin.id), isNull(S.users.deletedAt)));
      await assert.rejects(() => ensureAnotherMasterAdmin(tx, admin.id), (e: unknown) => e instanceof ApiError && e.status === 409);
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  ok("Proteção contra retirar o último administrador validada com rollback");

  await call("/api/admin/data", token);
  await call("/api/admin/data", token, "POST", { confirmation: "ERRADO", version: "x".repeat(64) }, 400);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7405101)`);
      // Isola os fixtures desta transação; todas estas alterações serão revertidas.
      await tx.update(S.batches).set({ isDemo: false }).where(eq(S.batches.isDemo, true));
      await tx.update(S.shipments).set({ isDemo: false }).where(eq(S.shipments.isDemo, true));
      const [demo] = await tx.insert(S.batches).values({ productId: productId!, number: 99999, brand, format: "750 g", status: "em_estoque", isDemo: true, createdByName: "Fixture demo", finishedAt: new Date() }).returning();
      await tx.insert(S.batchOutputs).values({ batchId: demo.id, packagingOptionId: item.packagingOptionId, label: "Caixa", unitsPerBox: 12, boxes: 10 });
      const [shipping] = await tx.insert(S.shipments).values({ packagingOptionId: item.packagingOptionId, boxes: 12, orderRef: "QA-bloqueio", createdByName: actor.name, isDemo: false }).returning();
      const blocked = await demoPreviewInTransaction(tx); assert.equal(blocked.demoBatches, 1); assert.ok(blocked.blockers.length > 0);
      await assert.rejects(() => clearDemoInTransaction(tx, actor, blocked.version), (e: unknown) => e instanceof ApiError && e.status === 409);
      await tx.delete(S.shipments).where(eq(S.shipments.id, shipping.id));
      const clean = await demoPreviewInTransaction(tx); assert.equal(clean.blockers.length, 0);
      await assert.rejects(() => clearDemoInTransaction(tx, actor, blocked.version), (e: unknown) => e instanceof ApiError && e.status === 409);
      await clearDemoInTransaction(tx, actor, clean.version);
      assert.equal((await tx.select().from(S.batches).where(eq(S.batches.id, demo.id))).length, 0);
      assert.equal((await tx.select().from(S.batches).where(eq(S.batches.id, batch.id))).length, 1);
      assert.equal(await stockBalance(tx, item.packagingOptionId), 5);
      assert.equal((await tx.select().from(S.products).where(eq(S.products.id, productId!))).length, 1);
      const [state] = await tx.select().from(S.appState).where(eq(S.appState.id, "lifecycle")); assert.ok(state.demoCleanedAt);
      throw new Rollback();
    });
  } catch (e) { if (!(e instanceof Rollback)) throw e; }
  ok("Limpeza remove só exemplos, preserva dados reais e bloqueia saldo negativo/prévia desatualizada (rollback)");

  const before = await call<ReportsDTO>(`/api/reports?brand=${brand}`, token); assert.equal(before.kpis.batches, 1); assert.equal(before.kpis.balance, 5);
  await call(`/api/batches/${batch.id}`, token, "DELETE");
  stock = await call<StockManageDTO>("/api/stock", token);
  const fresh = stock.rows.find((r) => r.id === item.id)!;
  await call("/api/stock/items", token, "DELETE", { id: fresh.id, revision: fresh.revision });
  const report = await call<ReportsDTO>(`/api/reports?brand=${brand}`, token); assert.equal(report.kpis.batches, 0); assert.equal(report.kpis.balance, 0); assert.equal(report.stock.length, 0);
  const audit = await call<ReportsDTO>(`/api/reports?brand=${brand}&includeDeleted=1`, token); assert.equal(audit.kpis.batches, 1);
  ok("Relatórios refletem exclusões de batelada e estoque; auditoria só aparece quando solicitada");

  const [countBefore] = await db.select({ n: count() }).from(S.users);
  assert.equal((await ensureReady()).ok, true);
  const [countAfter] = await db.select({ n: count() }).from(S.users);
  assert.equal(countBefore.n, countAfter.n);
  const [deletedUser] = await db.select().from(S.users).where(eq(S.users.id, created.id)); assert.ok(deletedUser.deletedAt); assert.equal(deletedUser.active, false);
  ok("Inicialização não recria nem reativa contas excluídas");
  console.log(`\n${tests} verificações aprovadas. Os exemplos existentes NÃO foram apagados.`);
}

async function cleanup() {
  if (productId) {
    const options = await db.select({ id: S.packagingOptions.id }).from(S.packagingOptions).where(eq(S.packagingOptions.productId, productId));
    const ids = options.map((o) => o.id);
    if (ids.length) {
      await db.delete(S.stockAdjustments).where(inArray(S.stockAdjustments.packagingOptionId, ids));
      await db.delete(S.shipments).where(inArray(S.shipments.packagingOptionId, ids));
      await db.delete(S.inventoryItems).where(inArray(S.inventoryItems.packagingOptionId, ids));
    }
    await db.delete(S.batches).where(eq(S.batches.productId, productId));
    await db.delete(S.products).where(eq(S.products.id, productId));
    await db.delete(S.productDimensionValues).where(eq(S.productDimensionValues.name, `QA-${suffix}`));
  }
  if (users.length) await db.delete(S.users).where(inArray(S.users.id, users));
  if (profiles.length) await db.delete(S.accessProfiles).where(inArray(S.accessProfiles.id, profiles));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await cleanup(); await pool.end(); });
