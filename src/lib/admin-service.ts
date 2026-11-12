import { and, count, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  batches,
  packagingOptions,
  productClassifications,
  productDimensionValues,
  productDimensions,
  products,
} from "@/db/schema";
import { ApiError, pgCode } from "@/lib/api";
import { BRAND_SLUG, type SessionUser } from "@/lib/domain";

/* ───────────── Validação ───────────── */

const name = z.string().trim().min(1, "Informe o nome.").max(40, "Use no máximo 40 caracteres.");
const format = z.string().trim().min(1, "Informe a gramatura (ex.: 450 g).").max(20, "Use no máximo 20 caracteres.");
const description = z
  .string()
  .trim()
  .max(120, "Use no máximo 120 caracteres.")
  .nullish()
  .transform((v) => v || null);
const id = z.number().int().positive();

const classification = z.object({ dimensionId: id, valueId: id.nullable() });

export const createDimensionSchema = z.object({ name });
export const updateDimensionSchema = z.object({ id, name: name.optional(), active: z.boolean().optional() });
export const createValueSchema = z.object({ dimensionId: id, name });
export const updateValueSchema = z.object({ id, name: name.optional(), active: z.boolean().optional() });
export const createProductSchema = z.object({
  brand: name,
  format,
  description,
  classifications: z.array(classification).optional(),
});
export const updateProductSchema = z.object({
  id,
  format: format.optional(),
  description: description.optional(),
  active: z.boolean().optional(),
  brand: name.optional(),
  classifications: z.array(classification).optional(),
});

/* ───────────── Auxiliares ───────────── */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function adminOnly(user: SessionUser) {
  if (user.role !== "admin") throw new ApiError(403, "Somente o administrador pode alterar cadastros.");
}

function slugify(value: string): string {
  const base = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "classificacao";
}

const duplicate = (what: string) => new ApiError(409, `Já existe ${what} com este nome.`);

async function brandDimension(tx: Tx) {
  const [row] = await tx.select().from(productDimensions).where(eq(productDimensions.slug, BRAND_SLUG)).limit(1);
  if (!row) throw new ApiError(500, "A classificação Marca não está configurada. Recarregue a página.");
  return row;
}

/** Valor da marca: reaproveita o existente (inclusive inativo) ou cria um novo. */
async function resolveBrandValue(tx: Tx, value: string) {
  const dimension = await brandDimension(tx);
  const [existing] = await tx
    .select()
    .from(productDimensionValues)
    .where(and(eq(productDimensionValues.dimensionId, dimension.id), eq(productDimensionValues.name, value)))
    .limit(1);
  if (existing) {
    if (!existing.active) {
      await tx.update(productDimensionValues).set({ active: true }).where(eq(productDimensionValues.id, existing.id));
    }
    return { ...existing, active: true };
  }
  const [created] = await tx.insert(productDimensionValues).values({ dimensionId: dimension.id, name: value }).returning();
  return created;
}

/** Aplica uma lista de classificações (null remove a vinculação). */
export async function applyClassifications(
  tx: Tx,
  productId: number,
  items: Array<{ dimensionId: number; valueId: number | null }>,
): Promise<string | null> {
  let brandName: string | null = null;
  for (const item of items) {
    const [dimension] = await tx.select().from(productDimensions).where(eq(productDimensions.id, item.dimensionId)).limit(1);
    if (!dimension) throw new ApiError(404, "Tipo de separação não encontrado.");
    if (item.valueId === null) {
      await tx
        .delete(productClassifications)
        .where(and(eq(productClassifications.productId, productId), eq(productClassifications.dimensionId, dimension.id)));
      continue;
    }
    const [value] = await tx
      .select()
      .from(productDimensionValues)
      .where(and(eq(productDimensionValues.id, item.valueId), eq(productDimensionValues.dimensionId, dimension.id)))
      .limit(1);
    if (!value) throw new ApiError(404, "Valor de classificação não encontrado.");
    const [existing] = await tx
      .select()
      .from(productClassifications)
      .where(and(eq(productClassifications.productId, productId), eq(productClassifications.dimensionId, dimension.id)))
      .limit(1);
    if (existing) {
      if (existing.valueId !== item.valueId) {
        await tx.update(productClassifications).set({ valueId: item.valueId }).where(eq(productClassifications.id, existing.id));
      }
    } else {
      await tx.insert(productClassifications).values({ productId, dimensionId: dimension.id, valueId: item.valueId });
    }
    if (dimension.slug === BRAND_SLUG) brandName = value.name;
  }
  return brandName;
}

/** Mantém o texto de marca do produto e das bateladas já registradas em sincronia. */
export async function syncBrand(tx: Tx, productId: number, newBrand: string): Promise<void> {
  const [product] = await tx.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product || product.brand === newBrand) return;
  try {
    await tx.update(products).set({ brand: newBrand }).where(eq(products.id, productId));
  } catch (e) {
    if (pgCode(e) === "23505") throw new ApiError(409, `Já existe um produto ${newBrand} ${product.format}.`);
    throw e;
  }
  await tx.update(batches).set({ brand: newBrand }).where(eq(batches.productId, productId));
}

/* ───────────── Dimensões ("tipos de separação") ───────────── */

export async function createDimension(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const { name: value } = createDimensionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const base = slugify(value);
    const taken = await tx.select({ id: productDimensions.id, slug: productDimensions.slug }).from(productDimensions);
    let slug = base;
    let n = 2;
    while (taken.some((d) => d.slug === slug)) slug = `${base}-${n++}`;
    try {
      const [row] = await tx.insert(productDimensions).values({ name: value, slug }).returning();
      return { id: row.id, slug: row.slug };
    } catch (e) {
      if (pgCode(e) === "23505") throw duplicate("um tipo de separação");
      throw e;
    }
  });
}

export async function updateDimension(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const { id: dimensionId, ...changes } = updateDimensionSchema.parse(raw);
  try {
    await db.update(productDimensions).set(changes).where(eq(productDimensions.id, dimensionId));
  } catch (e) {
    if (pgCode(e) === "23505") throw duplicate("um tipo de separação");
    throw e;
  }
}

export async function deleteDimension(user: SessionUser, dimensionId: number) {
  adminOnly(user);
  await db.transaction(async (tx) => {
    const [dimension] = await tx.select().from(productDimensions).where(eq(productDimensions.id, dimensionId));
    if (!dimension) throw new ApiError(404, "Tipo de separação não encontrado.");
    if (dimension.slug === BRAND_SLUG) {
      throw new ApiError(409, "Marca é uma separação essencial: as etiquetas e a numeração dependem dela. Você pode renomeá-la ou desativá-la.");
    }
    // As classificações e valores desta dimensão são removidos em cascata.
    await tx.delete(productDimensions).where(eq(productDimensions.id, dimensionId));
  });
}

/* ───────────── Valores (marcas, famílias, grupos…) ───────────── */

export async function createValue(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const data = createValueSchema.parse(raw);
  try {
    await db.insert(productDimensionValues).values(data);
  } catch (e) {
    if (pgCode(e) === "23505") throw duplicate("um valor");
    throw e;
  }
}

export async function updateValue(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const { id: valueId, ...changes } = updateValueSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [value] = await tx.select().from(productDimensionValues).where(eq(productDimensionValues.id, valueId));
    if (!value) throw new ApiError(404, "Valor não encontrado.");
    const [dimension] = await tx.select().from(productDimensions).where(eq(productDimensions.id, value.dimensionId));
    if (!dimension) throw new ApiError(404, "Tipo de separação não encontrado.");
    try {
      await tx.update(productDimensionValues).set(changes).where(eq(productDimensionValues.id, valueId));
    } catch (e) {
      if (pgCode(e) === "23505") throw duplicate("um valor");
      throw e;
    }
    // Renomear uma marca propaga para os produtos e para as bateladas antigas.
    if (dimension.slug === BRAND_SLUG && changes.name && changes.name !== value.name) {
      const affected = await tx.select({ id: products.id }).from(products).where(eq(products.brand, value.name));
      for (const p of affected) await syncBrand(tx, p.id, changes.name);
    }
  });
}

export async function deleteValue(user: SessionUser, valueId: number) {
  adminOnly(user);
  await db.transaction(async (tx) => {
    const [value] = await tx.select().from(productDimensionValues).where(eq(productDimensionValues.id, valueId));
    if (!value) throw new ApiError(404, "Valor não encontrado.");
    const [dimension] = await tx.select().from(productDimensions).where(eq(productDimensions.id, value.dimensionId));
    const [usage] = await tx
      .select({ n: count() })
      .from(productClassifications)
      .innerJoin(products, eq(products.id, productClassifications.productId))
      .where(and(eq(productClassifications.valueId, valueId), isNull(products.deletedAt)));
    const [byText] = await tx
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.brand, value.name), isNull(products.deletedAt)));
    const uses = (usage?.n ?? 0) + (dimension?.slug === BRAND_SLUG ? byText?.n ?? 0 : 0);
    if (uses > 0) {
      throw new ApiError(409, `Este valor está em uso por ${uses} produto(s). Troque a classificação deles antes de excluir, ou desative o valor.`);
    }
    await tx.delete(productDimensionValues).where(eq(productDimensionValues.id, valueId));
  });
}

/* ───────────── Produtos ───────────── */

export async function createProduct(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const data = createProductSchema.parse(raw);
  return db.transaction(async (tx) => {
    const brandValue = await resolveBrandValue(tx, data.brand);
    let inserted: { id: number };
    try {
      const [row] = await tx.insert(products).values({ brand: data.brand, format: data.format, description: data.description }).returning({ id: products.id });
      inserted = row;
    } catch (e) {
      if (pgCode(e) === "23505") throw new ApiError(409, "Já existe um produto com esta marca e gramatura.");
      throw e;
    }
    const brandDimensionRow = await brandDimension(tx);
    const items = data.classifications ?? [];
    if (!items.some((c) => c.dimensionId === brandDimensionRow.id)) {
      items.push({ dimensionId: brandDimensionRow.id, valueId: brandValue.id });
    }
    await applyClassifications(tx, inserted.id, items);
    return { id: inserted.id };
  });
}

export async function updateProduct(user: SessionUser, raw: unknown) {
  adminOnly(user);
  const { id: productId, brand, classifications, ...changes } = updateProductSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, productId)).for("update");
    if (!product) throw new ApiError(404, "Produto não encontrado.");
    if (Object.keys(changes).length > 0) {
      try {
        await tx.update(products).set(changes).where(eq(products.id, productId));
      } catch (e) {
        if (pgCode(e) === "23505") throw new ApiError(409, "Já existe um produto com esta marca e gramatura.");
        throw e;
      }
    }
    if (brand && brand !== product.brand) {
      const value = await resolveBrandValue(tx, brand);
      const dimension = await brandDimension(tx);
      await applyClassifications(tx, productId, [{ dimensionId: dimension.id, valueId: value.id }]);
      await syncBrand(tx, productId, brand);
    }
    if (classifications) {
      const newBrand = await applyClassifications(tx, productId, classifications);
      if (newBrand && newBrand !== product.brand) await syncBrand(tx, productId, newBrand);
    }
  });
}

/* ───────────── Alteração em massa ───────────── */

export const bulkUpdateSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "Selecione ao menos um produto.").max(100),
  classifications: z.array(classification).min(1, "Escolha ao menos uma classificação."),
});

export async function bulkUpdateProducts(user: SessionUser, raw: unknown): Promise<{ updated: number }> {
  adminOnly(user);
  const { ids, classifications } = bulkUpdateSchema.parse(raw);
  await db.transaction(async (tx) => {
    for (const id of ids) {
      const [product] = await tx.select().from(products).where(eq(products.id, id)).for("update");
      if (!product || product.deletedAt) throw new ApiError(404, `Produto ${id} não encontrado.`);
      const newBrand = await applyClassifications(tx, id, classifications);
      if (newBrand && newBrand !== product.brand) await syncBrand(tx, id, newBrand);
    }
  });
  return { updated: ids.length };
}

/** Exclusão lógica: o produto sai do cadastro, mas o histórico permanece íntegro. */
export async function deleteProduct(user: SessionUser, productId: number) {
  adminOnly(user);
  await db.transaction(async (tx) => {
    const [product] = await tx.select().from(products).where(eq(products.id, productId));
    if (!product) throw new ApiError(404, "Produto não encontrado.");
    if (product.deletedAt) throw new ApiError(409, "Este produto já foi excluído.");
    const [open] = await tx
      .select({ n: count() })
      .from(batches)
      .where(and(eq(batches.productId, productId), isNull(batches.deletedAt), ne(batches.status, "em_estoque")));
    if ((open?.n ?? 0) > 0) {
      throw new ApiError(
        409,
        `Há ${open!.n} batelada(s) em andamento deste produto. Exclua ou finalize as bateladas antes de excluir o produto.`,
      );
    }
    await tx
      .update(products)
      .set({ deletedAt: new Date(), deletedByName: user.name, active: false })
      .where(eq(products.id, productId));
    // Embalagens continuam no banco para preservar o saldo e as expedições.
    await tx.update(packagingOptions).set({ active: false }).where(eq(packagingOptions.productId, productId));
  });
}

