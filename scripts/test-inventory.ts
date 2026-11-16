/**
 * Teste de integração contra o servidor já iniciado. Não apaga dados existentes.
 * Execução: npm exec --yes --package=tsx -- tsx scripts/test-inventory.ts
 * Requer DATABASE_URL no .env; TEST_BASE_URL é opcional (padrão localhost:3000).
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "../src/db";
import { users, products, packagingOptions, inventoryItems, stockAdjustments, shipments, batches, productDimensionValues, batchOutputs } from "../src/db/schema";
import type { BoardDTO, InventoryRowDTO, ReportsDTO, StockManageDTO } from "../src/lib/domain";

const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const suffix = randomBytes(5).toString("hex");
const brand = `QA-${suffix}`;
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
const accountIds: number[] = [];
let productId: number | undefined;
let checks = 0;

function pass(message: string) { checks++; console.log(`✓ ${message}`); }
async function call<T>(path: string, token: string, method = "GET", body?: unknown, status = 200): Promise<T> {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", "x-tem-client": "1", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
  return data as T;
}
async function user(role: "admin" | "producao" | "logistica") {
  const email = `${role}-${suffix}@inventory.test`;
  const [row] = await db.insert(users).values({ name: `Teste estoque ${role}`, email, role, passwordHash }).returning({ id: users.id });
  accountIds.push(row.id);
  return (await call<{ token: string }>("/api/auth/login", "", "POST", { email, password })).token;
}
async function stock(token: string) { return call<StockManageDTO>("/api/stock", token); }
async function item(token: string, optionId: number): Promise<InventoryRowDTO> {
  const row = (await stock(token)).rows.find((r) => r.packagingOptionId === optionId);
  assert.ok(row, "O item deve estar listado"); return row;
}
async function makeReady(token: string, units: number) {
  const [batch] = [await call<{ id: number }>("/api/batches", token, "POST", {
    productId, garlicLot: "QA-AL", preservativeLot: "QA-CS", goodUnits: units, lossUnits: 0,
    mixStart: "2026-01-01T08:00:00Z", mixEnd: "2026-01-01T08:30:00Z",
    fillStart: "2026-01-01T08:35:00Z", fillEnd: "2026-01-01T09:00:00Z",
    finishStart: "2026-01-01T09:05:00Z", finishEnd: "2026-01-01T09:30:00Z", markReady: true,
  })];
  await call(`/api/batches/${batch.id}/transition`, token, "POST", { action: "liberar" });
  return batch.id;
}
async function finish(token: string, outputs: Array<{ packagingOptionId: number; boxes: number }>, units: number) {
  const id = await makeReady(token, units);
  await call(`/api/batches/${id}/transition`, token, "POST", { action: "finalizar", outputs });
  return id;
}

async function main() {
  await call("/api/stock", "", "GET", undefined, 401);
  const admin = await user("admin");
  const operator = await user("producao");
  const logistics = await user("logistica");
  productId = (await call<{ id: number }>("/api/admin/products", admin, "POST", { brand, format: "160 g" })).id;

  await call("/api/stock/items", admin, "POST", { productId, newPackaging: { label: "Caixa", unitsPerBox: 12 }, balance: 25, name: "Reserva teste", location: "A-02" });
  let a = (await stock(admin)).rows.find((r) => r.productId === productId)!;
  assert.ok(a); assert.equal(a.balance, 25); assert.equal(a.location, "A-02");
  const optionId = a.packagingOptionId;
  pass("Administrador cria item e embalagem com saldo inicial");
  await call("/api/stock/items", admin, "POST", { productId, packagingOptionId: optionId, balance: 1 }, 409);
  pass("Cadastro duplicado recusado");

  await call("/api/stock/items", admin, "POST", { productId, newPackaging: { label: "Caixa", unitsPerBox: 24 }, balance: 0 });
  const second = (await stock(admin)).rows.find((r) => r.productId === productId && r.unitsPerBox === 24)!;
  assert.ok(second); assert.equal(second.balance, 0);
  pass("Item com saldo zero permanece na tabela");
  await call("/api/stock/items", admin, "POST", { productId, newPackaging: { label: "Caixa", unitsPerBox: 40 }, balance: -1 }, 400);
  await call("/api/stock/items", admin, "POST", { productId, newPackaging: { label: "Caixa", unitsPerBox: 40 }, balance: 1.5 }, 400);
  pass("Quantidade negativa e fracionária recusadas");

  for (const token of [operator, logistics]) {
    await call("/api/stock/items", token, "POST", { productId, packagingOptionId: optionId, balance: 0 }, 403);
    await call("/api/stock/items", token, "PATCH", { id: a.id, revision: a.revision, balance: 10, reason: "teste" }, 403);
    await call("/api/stock/items", token, "DELETE", { id: a.id, revision: a.revision }, 403);
  }
  pass("Criação, edição e exclusão de itens restritas ao administrador");

  await call("/api/stock/items", admin, "PATCH", { id: a.id, revision: a.revision, balance: 30, name: "Reserva atualizada", location: "B-01", reason: "Conferência física" });
  a = await item(admin, optionId); assert.equal(a.balance, 30); assert.equal(a.name, "Reserva atualizada");
  pass("Edição do saldo total e dos dados do item");

  const batchId = await finish(admin, [{ packagingOptionId: optionId, boxes: 10 }], 120);
  a = await item(admin, optionId); assert.equal(a.balance, 40); assert.equal(a.produced, 10);
  await call(`/api/batches/${batchId}/transition`, admin, "POST", { action: "finalizar", outputs: [{ packagingOptionId: optionId, boxes: 10 }] }, 409);
  assert.equal((await item(admin, optionId)).balance, 40);
  const receipts = (await stock(admin)).receipts.filter((r) => r.batchId === batchId);
  assert.equal(receipts.length, 1); assert.equal(receipts[0].boxes, 10);
  pass("Finalização recebe caixas automaticamente e não duplica ao repetir");

  await call("/api/stock/items", admin, "PATCH", { id: a.id, revision: a.revision, balance: 55, name: a.name, location: a.location, reason: "Contagem corrigida" });
  const original = await db.select().from(batchOutputs).where(eq(batchOutputs.batchId, batchId));
  assert.equal(original[0].boxes, 10);
  const current = await item(admin, optionId);
  await call("/api/shipments", logistics, "POST", { packagingOptionId: optionId, boxes: 40, orderRef: `QA-${suffix}` });
  assert.equal((await item(admin, optionId)).balance, 15);
  await call("/api/stock/items", admin, "PATCH", { id: current.id, revision: current.revision, balance: 100, reason: "Tela velha" }, 409);
  pass("Expedição usa saldo manual e produção; edição desatualizada é bloqueada");

  await finish(admin, [{ packagingOptionId: optionId, boxes: 6 }, { packagingOptionId: second.packagingOptionId, boxes: 3 }], 144);
  a = await item(admin, optionId); assert.equal(a.balance, 21); assert.equal((await item(admin, second.packagingOptionId)).balance, 3);
  const report = await call<ReportsDTO>(`/api/reports?brand=${brand}`, admin);
  assert.equal(report.stock.find((r) => r.packagingOptionId === optionId)?.balance, 21);
  const board = await call<BoardDTO>("/api/board", admin);
  assert.equal(board.stock.find((r) => r.packagingOptionId === optionId)?.balance, 21);
  pass("Duas embalagens recebem caixas e saldo é igual no Kanban e relatórios");

  await call("/api/stock/items", admin, "DELETE", { id: a.id, revision: a.revision });
  assert.ok(!(await stock(admin)).rows.some((r) => r.id === a.id));
  assert.ok((await stock(admin)).receipts.some((r) => r.batchId === batchId));
  const opening = (await stock(admin)).adjustments.find((m) => m.packagingOptionId === optionId && m.kind === "opening")!;
  assert.ok(opening); assert.equal(opening.canModify, false);
  await call(`/api/stock/adjustments?id=${opening.id}`, admin, "DELETE", undefined, 409);
  pass("Exclusão retira item e preserva produção e trilha de auditoria");

  await finish(admin, [{ packagingOptionId: optionId, boxes: 2 }], 24);
  a = await item(admin, optionId); assert.equal(a.balance, 2);
  pass("Batelada após exclusão reabre o item somente com as novas caixas");

  const concurrent = await makeReady(admin, 36);
  const responses = await Promise.all([0, 1].map(() => fetch(`${base}/api/batches/${concurrent}/transition`, {
    method: "POST", headers: { "content-type": "application/json", "x-tem-client": "1", authorization: `Bearer ${admin}` },
    body: JSON.stringify({ action: "finalizar", outputs: [{ packagingOptionId: optionId, boxes: 3 }] }),
  })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  a = await item(admin, optionId); assert.equal(a.balance, 5);
  pass("Duas finalizações simultâneas contabilizam uma única entrada");

  const edits = await Promise.all([0, 1].map(() => fetch(`${base}/api/stock/items`, {
    method: "PATCH", headers: { "content-type": "application/json", "x-tem-client": "1", authorization: `Bearer ${admin}` },
    body: JSON.stringify({ id: a.id, revision: a.revision, balance: 10, reason: "Conferência concorrente" }),
  })));
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await item(admin, optionId)).balance, 10);
  const outs = await Promise.all([0, 1].map(() => fetch(`${base}/api/shipments`, {
    method: "POST", headers: { "content-type": "application/json", "x-tem-client": "1", authorization: `Bearer ${logistics}` },
    body: JSON.stringify({ packagingOptionId: optionId, boxes: 8, orderRef: `QA-race-${suffix}` }),
  })));
  assert.deepEqual(outs.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await item(admin, optionId)).balance, 2);
  pass("Edições/saídas concorrentes não perdem entrada nem tornam saldo negativo");

  const third = await call<{ id: number }>("/api/admin/packaging", admin, "POST", { productId, label: "Caixa", unitsPerBox: 40 });
  void third;
  const [option40] = await db.select().from(packagingOptions).where(eq(packagingOptions.productId, productId)).then((rows) => rows.filter((o) => o.unitsPerBox === 40));
  await finish(admin, [{ packagingOptionId: option40.id, boxes: 2 }], 80);
  const auto = await item(admin, option40.id); assert.equal(auto.source, "production"); assert.equal(auto.balance, 2);
  pass("Embalagem nunca cadastrada no estoque vira item automaticamente");
  console.log(`\n${checks} verificações de integração aprovadas.`);
}

async function cleanup() {
  if (productId) {
    const options = await db.select({ id: packagingOptions.id }).from(packagingOptions).where(eq(packagingOptions.productId, productId));
    const ids = options.map((o) => o.id);
    if (ids.length) {
      await db.delete(stockAdjustments).where(inArray(stockAdjustments.packagingOptionId, ids));
      await db.delete(shipments).where(inArray(shipments.packagingOptionId, ids));
      await db.delete(inventoryItems).where(inArray(inventoryItems.packagingOptionId, ids));
    }
    await db.delete(batches).where(eq(batches.productId, productId));
    await db.delete(products).where(eq(products.id, productId));
    await db.delete(productDimensionValues).where(eq(productDimensionValues.name, brand));
  }
  if (accountIds.length) await db.delete(users).where(inArray(users.id, accountIds));
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await cleanup(); await pool.end(); });
