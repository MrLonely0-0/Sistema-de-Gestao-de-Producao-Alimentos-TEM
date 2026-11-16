/** Teste de importação e favicon. Usa/restaura a configuração anterior; apenas em ambiente de teste. */
import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db, pool } from "../src/db";
import { siteBranding, users } from "../src/db/schema";
import type { BrandingInfo } from "../src/lib/branding-shared";

const base = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const suffix = randomBytes(5).toString("hex");
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const passwordHash = `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
const accounts: number[] = [];

async function request(path: string, token: string, method = "GET", body?: unknown, expected = 200) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", "x-tem-client": "1", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  assert.equal(res.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function login(role: "admin" | "producao") {
  const email = `branding-${role}-${suffix}@test.local`;
  const [u] = await db.insert(users).values({ name: `Teste visual ${role}`, email, role, passwordHash }).returning({ id: users.id });
  accounts.push(u.id);
  return (await request("/api/auth/login", "", "POST", { email, password })).token as string;
}

async function main() {
  const [previous] = await db.select().from(siteBranding).where(eq(siteBranding.id, "main"));
  try {
    const admin = await login("admin");
    const operator = await login("producao");
    await request("/api/admin/branding", "", "GET", undefined, 401);
    await request("/api/admin/branding", operator, "POST", { name: "teste.png", imageData: "x" }, 403);
    console.log("✓ Importação protegida: usuário anônimo e operador não podem alterar a marca");
    await request("/api/admin/branding", admin, "POST", { name: "falso.png", imageData: "data:image/png;base64,AAAA" }, 400);
    await request("/api/admin/branding", admin, "POST", { name: "falso.svg", imageData: "data:image/svg+xml;base64,AAAA" }, 400);
    console.log("✓ Arquivos falsos e SVG são recusados");

    // Deliberadamente não é a arte do usuário: este PNG só existe durante os testes.
    const original = await sharp({ create: { width: 550, height: 550, channels: 4, background: { r: 80, g: 34, b: 190, alpha: 0.7 } } }).png().toBuffer();
    const result = await request("/api/admin/branding", admin, "POST", { name: "TESTE-TEMPORARIO.png", imageData: `data:image/png;base64,${original.toString("base64")}` });
    assert.ok(result.version);
    const { branding, imageDataUrl } = await request("/api/admin/branding", admin) as { branding: BrandingInfo; imageDataUrl: string | null };
    assert.equal(imageDataUrl, `data:image/png;base64,${original.toString("base64")}`);
    assert.equal(branding.width, 550); assert.equal(branding.height, 550);
    const served = await fetch(`${base}${branding.imageUrl}`);
    assert.equal(served.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), original);
    console.log("✓ PNG original servido idêntico byte a byte, sem corte, recoloração ou compressão adicional");

    for (const [size, url] of [[16, branding.icon16Url], [32, branding.icon32Url], [180, branding.appleUrl]] as const) {
      const r = await fetch(`${base}${url}`);
      assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
      const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      assert.equal(meta.width, size); assert.equal(meta.height, size); assert.equal(meta.hasAlpha, true);
    }
    console.log("✓ Favicons PNG 16×16, 32×32 e ícone 180×180 com transparência");
    const unchanged = await fetch(`${base}${branding.icon32Url}`, { headers: { "If-None-Match": `"${branding.version}-favicon-32x32.png"` } });
    assert.equal(unchanged.status, 304);
    const html = await (await fetch(`${base}/login`)).text();
    assert.match(html, /rel="icon"[^>]*href="[^\"]*favicon-16x16\.png[^>]*sizes="16x16"|rel="icon"[^>]*sizes="16x16"[^>]*href="[^\"]*favicon-16x16\.png/);
    assert.ok(html.includes("favicon-32x32.png")); assert.ok(html.includes("image/png"));
    assert.ok(html.includes("cosmic-splash"));
    assert.ok(html.includes(`data:image/png;base64,${original.toString("base64")}`));
    assert.ok(!html.includes(`as="image" href="${branding.imageUrl}"`));
    console.log("✓ Ícones PNG no head e original embutido no HTML, sem depender de outra requisição de imagem");

    const nonSquare = await sharp({ create: { width: 40, height: 80, channels: 4, background: { r: 255, g: 0, b: 100, alpha: 1 } } }).png().toBuffer();
    const next = await request("/api/admin/branding", admin, "POST", { name: "TESTE-PROPORCAO.png", imageData: `data:image/png;base64,${nonSquare.toString("base64")}` });
    assert.notEqual(next.version, result.version);
    const png = await (await fetch(`${base}/brand/favicon-32x32.png?v=${next.version}`)).arrayBuffer();
    const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(data[(16 * info.width) * 4 + 3], 0); // padding transparente à esquerda
    assert.equal(data[(16 * info.width + 16) * 4 + 3], 255); // imagem preservada no centro
    console.log("✓ Redimensionamento proporcional, sem crop, e versão nova invalida o cache");
  } finally {
    if (previous) await db.insert(siteBranding).values(previous).onConflictDoUpdate({ target: siteBranding.id, set: previous });
    else await db.delete(siteBranding).where(eq(siteBranding.id, "main"));
    if (accounts.length) await db.delete(users).where(inArray(users.id, accounts));
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
