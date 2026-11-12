import { count, eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  batches,
  batchEvents,
  batchOutputs,
  packagingOptions,
  kanbanColumns,
  productClassifications,
  productDimensionValues,
  productDimensions,
  products,
  sessions,
  shipments,
  users,
} from "@/db/schema";
import { pgCode } from "@/lib/api";
import { hashPassword } from "@/lib/auth";
import { createBatchFolder } from "@/lib/drive";
import type { ColumnFeature, Role, Status } from "@/lib/domain";

/**
 * Inicialização do banco (idempotente, roda uma vez por processo):
 *  - garante a conta do gestor (administrador) em ADMIN_EMAIL / ADMIN_PASSWORD;
 *  - instala o trigger que torna o carimbo de liberação imutável;
 *  - cadastra o catálogo inicial (marcas, formatos e embalagens);
 *  - em modo demonstração (padrão), cria um usuário por perfil e algumas
 *    bateladas de exemplo.
 */

export const DEMO_MODE = process.env.DEMO_MODE !== "off";
export const DEMO_PASSWORD = "tem12345";

/**
 * Conta do gestor. Os valores padrão abaixo são os do ambiente de
 * demonstração — em produção defina ADMIN_EMAIL e ADMIN_PASSWORD no provedor
 * (e troque a senha em Admin › Usuários, ou apague e recrie a conta).
 */
export const GESTOR_EMAIL = (process.env.ADMIN_EMAIL?.trim() || "vinicius@tem.com.br").toLowerCase();
export const GESTOR_PASSWORD = process.env.ADMIN_PASSWORD || "#Vini2183";
export const GESTOR_NAME = process.env.ADMIN_NAME?.trim() || "Vinicius";

/** Pessoas de demonstração (cada uma vê o sistema por um perfil diferente). */
export const DEMO_USERS: Array<{ name: string; email: string; role: Role }> = [
  { name: "Marina Costa", email: "admin@tem.demo", role: "admin" },
  { name: "João Pereira", email: "producao@tem.demo", role: "producao" },
  { name: "Camila Rocha", email: "qualidade@tem.demo", role: "qualidade" },
  { name: "Rafael Lima", email: "acabamento@tem.demo", role: "acabamento" },
  { name: "Bruno Alves", email: "logistica@tem.demo", role: "logistica" },
];

const BRANDS = ["TEM", "Feliz"];

// Embalagens de exemplo — ajuste livremente em Admin › Produtos e embalagens.
const FORMATS: Array<{ format: string; packaging: Array<[label: string, units: number]> }> = [
  { format: "160 g", packaging: [["Pack", 12], ["Caixa", 24], ["Caixa", 40]] },
  { format: "450 g", packaging: [["Caixa", 12], ["Caixa", 24]] },
  { format: "1 kg", packaging: [["Pack", 6], ["Caixa", 12]] },
  { format: "2 kg", packaging: [["Caixa", 6]] },
  { format: "3 kg", packaging: [["Caixa", 4]] },
];

const GUARD_SQL = `
CREATE OR REPLACE FUNCTION tem_lock_release_stamp() RETURNS trigger AS $fn$
BEGIN
  IF OLD.released_at IS NOT NULL AND (
       NEW.released_at IS DISTINCT FROM OLD.released_at
    OR NEW.released_by_name IS DISTINCT FROM OLD.released_by_name
  ) THEN
    RAISE EXCEPTION 'carimbo de liberacao imutavel';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_lock_release_stamp') THEN
    CREATE TRIGGER trg_lock_release_stamp
      BEFORE UPDATE ON batches
      FOR EACH ROW EXECUTE FUNCTION tem_lock_release_stamp();
  END IF;
END $do$;
`;

export type ReadyState = { ok: true } | { ok: false; reason: "schema" | "admin_env" | "db" };

let cached: Promise<ReadyState> | null = null;

/** Idempotente e barato: roda de fato uma vez por processo. */
export function ensureReady(): Promise<ReadyState> {
  cached ??= init().then((state) => {
    if (!state.ok) cached = null;
    return state;
  });
  return cached;
}

async function init(): Promise<ReadyState> {
  try {
    await seed();
    await pool.query(GUARD_SQL).catch((e: Error) => {
      console.warn("[init] trigger de imutabilidade não instalado:", e.message);
    });
    return { ok: true };
  } catch (e) {
    if (pgCode(e) === "42P01") return { ok: false, reason: "schema" };
    console.error("[init]", e);
    return { ok: false, reason: "db" };
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function seedColumns(tx: Tx): Promise<void> {
  const [{ n }] = await tx.select({ n: count() }).from(kanbanColumns);
  if (n > 0) return;
  const defaults: Array<{
    name: string;
    subtitle: string;
    accent: string;
    role: Role;
    statuses: Status[];
    features: ColumnFeature[];
    showStock?: boolean;
  }> = [
    {
      name: "Produção", subtitle: "Entrada de bateladas", accent: "prod", role: "producao",
      statuses: ["em_preparo"], features: ["criar", "editar", "marcar_pronto", "anexar", "excluir"],
    },
    {
      name: "Qualidade", subtitle: "Aprovação ou retenção", accent: "qual", role: "qualidade",
      statuses: ["pronto", "retido"], features: ["liberar", "reter", "devolver", "anexar", "excluir"],
    },
    {
      name: "Acabamento", subtitle: "Unidades em caixas", accent: "acab", role: "acabamento",
      statuses: ["liberado"], features: ["finalizar", "anexar", "excluir"],
    },
    {
      name: "Estoque e Logística", subtitle: "Saldo para expedição", accent: "ink", role: "logistica",
      statuses: ["em_estoque"], features: ["separar", "anexar", "excluir"], showStock: true,
    },
  ];
  for (const [i, c] of defaults.entries()) {
    await tx.insert(kanbanColumns).values({
      name: c.name,
      subtitle: c.subtitle,
      accent: c.accent,
      position: i + 1,
      role: c.role,
      statuses: c.statuses,
      features: c.features,
      showStock: c.showStock ?? false,
    });
  }
}

async function seedDimensions(tx: Tx): Promise<void> {
  const [{ n }] = await tx.select({ n: count() }).from(productDimensions);
  if (n > 0) return;
  const definitions = [
    { name: "Marca", slug: "marca", values: ["TEM", "Feliz"] },
    { name: "Família", slug: "familia", values: ["Alho triturado", "Molho", "Creme"] },
    { name: "Grupo", slug: "grupo", values: ["Tradicional", "Premium", "Food Service"] },
  ];
  const bySlug = new Map<string, { id: number; values: Map<string, number> }>();
  for (const def of definitions) {
    const [dimension] = await tx
      .insert(productDimensions)
      .values({ name: def.name, slug: def.slug })
      .returning({ id: productDimensions.id });
    const values = new Map<string, number>();
    for (const value of def.values) {
      const [row] = await tx
        .insert(productDimensionValues)
        .values({ dimensionId: dimension.id, name: value })
        .returning({ id: productDimensionValues.id });
      values.set(value, row.id);
    }
    bySlug.set(def.slug, { id: dimension.id, values });
  }
  const brand = bySlug.get("marca")!;
  const family = bySlug.get("familia")!;
  const group = bySlug.get("grupo")!;
  const allProducts = await tx.select({ id: products.id, brand: products.brand, format: products.format }).from(products);
  for (const p of allProducts) {
    const familyName = p.brand === "Feliz" ? "Molho" : "Alho triturado";
    const groupName = /kg/.test(p.format) ? "Food Service" : "Tradicional";
    await tx.insert(productClassifications).values([
      { productId: p.id, dimensionId: brand.id, valueId: brand.values.get(p.brand)! },
      { productId: p.id, dimensionId: family.id, valueId: family.values.get(familyName)! },
      { productId: p.id, dimensionId: group.id, valueId: group.values.get(groupName)! },
    ]);
  }
}

/**
 * Garante que a conta do gestor exista e seja administradora ativa.
 * Nunca sobrescreve a senha de quem já entrou e trocou a própria senha.
 */
async function ensureGestor(tx: Tx): Promise<boolean> {
  const [existing] = await tx.select().from(users).where(eq(users.email, GESTOR_EMAIL)).limit(1);
  if (existing) {
    if (existing.role !== "admin" || !existing.active) {
      await tx.update(users).set({ role: "admin", active: true }).where(eq(users.id, existing.id));
      await tx.delete(sessions).where(eq(sessions.userId, existing.id));
    }
    return true;
  }
  await tx.insert(users).values({
    name: GESTOR_NAME,
    email: GESTOR_EMAIL,
    role: "admin",
    passwordHash: hashPassword(GESTOR_PASSWORD),
  });
  return true;
}

async function seed(): Promise<boolean> {
  return db.transaction(async (tx) => {
    // Evita seed duplicado quando duas instâncias sobem ao mesmo tempo.
    await tx.execute(sql`select pg_advisory_xact_lock(7405101)`);

    /* Gestor — criado se faltar, mesmo em banco já em uso. */
    await ensureGestor(tx);

    /* Catálogo — só o gestor tem conta; os demais nomes abaixo são históricos. */
    /* Catálogo */
    const [{ n: productCount }] = await tx.select({ n: count() }).from(products);
    if (productCount === 0) {
      for (const brand of BRANDS) {
        for (const f of FORMATS) {
          const [p] = await tx.insert(products).values({ brand, format: f.format }).returning({ id: products.id });
          await tx
            .insert(packagingOptions)
            .values(f.packaging.map(([label, unitsPerBox]) => ({ productId: p.id, label, unitsPerBox })));
        }
      }
    }
    /* Colunas do quadro e classificações dinâmicas. */
    await seedColumns(tx);
    await seedDimensions(tx);
    if (!DEMO_MODE || productCount > 0) return true;

    /* Bateladas de exemplo (somente demonstração) */
    const productRows = await tx.select().from(products);
    const optionRows = await tx.select().from(packagingOptions);
    const product = (brand: string, format: string) => productRows.find((p) => p.brand === brand && p.format === format)!;
    const option = (productId: number, units: number) =>
      optionRows.find((o) => o.productId === productId && o.unitsPerBox === units)!;
    const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);
    const by = (role: Role) => DEMO_USERS.find((u) => u.role === role)!.name; // nomes históricos dos eventos

    type Demo = Partial<typeof batches.$inferInsert> & {
      brand: string;
      format: string;
      events: Array<[type: string, message: string, role: Role, hoursAgo: number]>;
      outputs?: Array<[units: number, boxes: number]>;
    };

    const full = (start: number) => ({
      mixStart: ago(start),
      mixEnd: ago(start - 0.75),
      fillStart: ago(start - 1),
      fillEnd: ago(start - 2.5),
      finishStart: ago(start - 2.6),
      finishEnd: ago(start - 3.4),
    });

    const demos: Demo[] = [
      {
        brand: "TEM", format: "450 g", status: "em_estoque",
        garlicLot: "AL-2291", preservativeLot: "CS-0118", ...full(52), goodUnits: 1450, lossUnits: 22,
        createdAt: ago(52), readyAt: ago(48), releasedAt: ago(47), releasedByName: by("qualidade"),
        finishedAt: ago(45), finishedByName: by("acabamento"),
        outputs: [[12, 80], [24, 20]],
        events: [
          ["criada", 'Batelada #1 aberta em "Em preparo".', "producao", 52],
          ["pronto", "Marcada como Pronto e enviada à Qualidade.", "producao", 48],
          ["liberado", "Lote LIBERADO pela Qualidade. Carimbo de data e hora registrado.", "qualidade", 47],
          ["finalizado", "Acabamento concluído: 80 × Caixa c/ 12 + 20 × Caixa c/ 24. Enviado ao estoque.", "acabamento", 45],
        ],
      },
      {
        brand: "TEM", format: "1 kg", status: "em_estoque",
        garlicLot: "AL-2291", preservativeLot: "CS-0118", ...full(30), goodUnits: 612, lossUnits: 9,
        createdAt: ago(30), readyAt: ago(26), releasedAt: ago(25.5), releasedByName: by("qualidade"),
        finishedAt: ago(24), finishedByName: by("acabamento"),
        outputs: [[12, 50]],
        events: [
          ["criada", 'Batelada #1 aberta em "Em preparo".', "producao", 30],
          ["pronto", "Marcada como Pronto e enviada à Qualidade.", "producao", 26],
          ["liberado", "Lote LIBERADO pela Qualidade. Carimbo de data e hora registrado.", "qualidade", 25.5],
          ["finalizado", "Acabamento concluído: 50 × Caixa c/ 12. Enviado ao estoque.", "acabamento", 24],
        ],
      },
      {
        brand: "Feliz", format: "160 g", status: "liberado",
        garlicLot: "AL-2304", preservativeLot: "CS-0121", ...full(9), goodUnits: 2400, lossUnits: 36,
        createdAt: ago(9), readyAt: ago(5.2), releasedAt: ago(1.4), releasedByName: by("qualidade"),
        events: [
          ["criada", 'Batelada #1 aberta em "Em preparo".', "producao", 9],
          ["pronto", "Marcada como Pronto e enviada à Qualidade.", "producao", 5.2],
          ["liberado", "Lote LIBERADO pela Qualidade. Carimbo de data e hora registrado.", "qualidade", 1.4],
        ],
      },
      {
        brand: "TEM", format: "450 g", status: "retido",
        garlicLot: "AL-2304", preservativeLot: "CS-0121", ...full(8), goodUnits: 1380, lossUnits: 51,
        createdAt: ago(8), readyAt: ago(4.4), heldAt: ago(2),
        qualityNote: "pH acima do limite na primeira leitura. Aguardando reanálise da amostra.",
        events: [
          ["criada", 'Batelada #2 aberta em "Em preparo".', "producao", 8],
          ["pronto", "Marcada como Pronto e enviada à Qualidade.", "producao", 4.4],
          ["retido", "Lote RETIDO. Motivo: pH acima do limite na primeira leitura. Aguardando reanálise da amostra.", "qualidade", 2],
        ],
      },
      {
        brand: "Feliz", format: "450 g", status: "pronto",
        garlicLot: "AL-2310", preservativeLot: "CS-0121", ...full(4.6), goodUnits: 1296, lossUnits: 14,
        createdAt: ago(4.6), readyAt: ago(1),
        events: [
          ["criada", 'Batelada #1 aberta em "Em preparo".', "producao", 4.6],
          ["pronto", "Marcada como Pronto e enviada à Qualidade.", "producao", 1],
        ],
      },
      {
        brand: "TEM", format: "2 kg", status: "em_preparo",
        garlicLot: "AL-2310", preservativeLot: "CS-0122",
        mixStart: ago(1.8), mixEnd: ago(1.1), fillStart: ago(0.9),
        createdAt: ago(1.8),
        events: [["criada", 'Batelada #1 aberta em "Em preparo".', "producao", 1.8]],
      },
      {
        brand: "TEM", format: "160 g", status: "em_preparo",
        garlicLot: "AL-2310", mixStart: ago(0.3),
        createdAt: ago(0.3),
        events: [["criada", 'Batelada #1 aberta em "Em preparo".', "producao", 0.3]],
      },
    ];

    const counters = new Map<number, number>();
    for (const demo of demos) {
      const { events, outputs, ...fields } = demo;
      const p = product(demo.brand, demo.format);
      const number = (counters.get(p.id) ?? 0) + 1;
      counters.set(p.id, number);
      const folder = await createBatchFolder({ brand: p.brand, format: p.format, number });
      const [row] = await tx
        .insert(batches)
        .values({
          ...fields,
          productId: p.id,
          number,
          createdByName: by("producao"),
          updatedAt: ago(events[events.length - 1][3]),
          lastChangedByName: by("producao"),
          lastChangedByRole: "producao",
          lastChangedAt: ago(events[events.length - 1][3]),
          driveFolderId: folder.id,
          driveFolderPath: folder.path,
        })
        .returning({ id: batches.id });
      await tx.insert(batchEvents).values([
        ...events.map(([type, message, role, hours]) => ({
          batchId: row.id,
          type,
          message,
          userName: by(role),
          createdAt: ago(hours),
        })),
        {
          batchId: row.id,
          type: "drive",
          message: `Pasta criada no Drive (simulado): ${folder.path}`,
          userName: by("producao"),
          createdAt: ago(events[0][3]),
        },
      ]);
      if (outputs) {
        await tx.insert(batchOutputs).values(
          outputs.map(([units, boxes]) => {
            const o = option(p.id, units);
            return { batchId: row.id, packagingOptionId: o.id, label: o.label, unitsPerBox: o.unitsPerBox, boxes };
          }),
        );
      }
    }
    for (const [productId, n] of counters) {
      await tx.update(products).set({ batchCounter: n }).where(eq(products.id, productId));
    }

    const tem450 = product("TEM", "450 g");
    await tx.insert(shipments).values({
      packagingOptionId: option(tem450.id, 12).id,
      boxes: 30,
      orderRef: "PED-1042",
      createdByName: by("logistica"),
      createdAt: ago(20),
    });

    return true;
  });
}
