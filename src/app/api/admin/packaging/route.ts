import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { packagingOptions, products } from "@/db/schema";
import { ApiError, handle, parseId, pgCode, readBody, requireAdmin } from "@/lib/api";

const createSchema = z.object({
  productId: z.number().int().positive(),
  label: z.string().trim().min(1, "Informe o tipo de embalagem (ex.: Caixa).").max(20, "Use no máximo 20 caracteres."),
  unitsPerBox: z
    .number()
    .int("Use um número inteiro de unidades.")
    .min(1, "A embalagem precisa ter ao menos 1 unidade.")
    .max(1000, "Máximo de 1.000 unidades por embalagem."),
});
const updateSchema = z.object({ id: z.number().int().positive(), active: z.boolean() });

export const POST = handle(async (req) => {
  await requireAdmin(req);
  const data = await readBody(req, createSchema);
  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, data.productId));
  if (!product) throw new ApiError(404, "Produto não encontrado.");
  try {
    await db.insert(packagingOptions).values(data);
  } catch (e) {
    if (pgCode(e) === "23505") throw new ApiError(409, "Esta embalagem já está vinculada ao produto.");
    throw e;
  }
  return { ok: true };
});

// A quantidade por caixa não é editável de propósito: mudaria o significado do
// estoque já produzido. Para corrigir, desative e cadastre outra.
export const PATCH = handle(async (req) => {
  await requireAdmin(req);
  const { id, active } = await readBody(req, updateSchema);
  const [row] = await db
    .update(packagingOptions)
    .set({ active })
    .where(eq(packagingOptions.id, id))
    .returning({ id: packagingOptions.id });
  if (!row) throw new ApiError(404, "Embalagem não encontrada.");
  return { ok: true };
});

export const DELETE = handle(async (req) => {
  await requireAdmin(req);
  const id = parseId(req.nextUrl.searchParams.get("id") ?? "");
  try {
    await db.delete(packagingOptions).where(eq(packagingOptions.id, id));
  } catch (e) {
    if (pgCode(e) === "23503") {
      throw new ApiError(409, "Esta embalagem já foi usada em bateladas ou expedições. Desative-a em vez de excluir.");
    }
    throw e;
  }
  return { ok: true };
});
