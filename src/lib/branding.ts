import { cache } from "react";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { db, hasDatabaseUrl } from "@/db";
import { siteBranding } from "@/db/schema";
import { ApiError, pgCode } from "@/lib/api";
import { BRAND_IMAGE_MAX_BYTES, BRAND_IMAGE_MAX_SIDE, brandAssetUrl, type BrandingInfo } from "@/lib/branding-shared";
import type { SessionUser } from "@/lib/domain";

const KEY = "main";

function isSchemaMissing(e: unknown): boolean {
  const code = pgCode(e);
  return code === "42P01" || code === "42703";
}

/** Não carrega o base64 do original para renderizar a página. */
export const getBrandingInfo = cache(async (): Promise<BrandingInfo | null> => {
  if (!hasDatabaseUrl) return null;
  try {
    const [row] = await db.select({
      version: siteBranding.version, originalName: siteBranding.originalName,
      width: siteBranding.width, height: siteBranding.height,
      updatedAt: siteBranding.updatedAt, updatedByName: siteBranding.updatedByName,
    }).from(siteBranding).where(eq(siteBranding.id, KEY));
    if (!row) return null;
    return {
      ...row, updatedAt: row.updatedAt.toISOString(),
      imageUrl: brandAssetUrl("cosmic-cat.png", row.version),
      icon16Url: brandAssetUrl("favicon-16x16.png", row.version),
      icon32Url: brandAssetUrl("favicon-32x32.png", row.version),
      appleUrl: brandAssetUrl("apple-touch-icon.png", row.version),
    };
  } catch (e) {
    // Falha na leitura da identidade visual não pode derrubar o layout nem o `next build`.
    if (!isSchemaMissing(e)) {
      console.warn("[branding] indisponível ao carregar metadados:", e instanceof Error ? e.message : e);
    }
    return null;
  }
});

/**
 * O original viaja junto com a página: não depende de uma segunda chamada
 * de imagem (que pode receber 204/403 no proxy da pré-visualização).
 * O prefixo PNG é conferido; a decodificação final também é verificada no navegador.
 */
export const getSplashImageData = cache(async (): Promise<string | null> => {
  if (!hasDatabaseUrl) return null;
  try {
    const [row] = await db.select({ png: siteBranding.originalPng }).from(siteBranding).where(eq(siteBranding.id, KEY));
    if (!row?.png || row.png.length > Math.ceil(BRAND_IMAGE_MAX_BYTES * 4 / 3) + 4) return null;
    const signature = Buffer.from(row.png.slice(0, 16), "base64");
    if (!signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
    return `data:image/png;base64,${row.png}`;
  } catch (e) {
    if (!isSchemaMissing(e)) {
      console.warn("[branding] indisponível ao carregar splash:", e instanceof Error ? e.message : e);
    }
    return null;
  }
});

export async function getAdminBrandingState(): Promise<{ branding: BrandingInfo | null; imageDataUrl: string | null }> {
  const [row] = await db.select().from(siteBranding).where(eq(siteBranding.id, KEY));
  if (!row) return { branding: null, imageDataUrl: null };
  const branding: BrandingInfo = {
    version: row.version,
    originalName: row.originalName,
    width: row.width,
    height: row.height,
    updatedAt: row.updatedAt.toISOString(),
    updatedByName: row.updatedByName,
    imageUrl: brandAssetUrl("cosmic-cat.png", row.version),
    icon16Url: brandAssetUrl("favicon-16x16.png", row.version),
    icon32Url: brandAssetUrl("favicon-32x32.png", row.version),
    appleUrl: brandAssetUrl("apple-touch-icon.png", row.version),
  };
  const signature = Buffer.from(row.originalPng.slice(0, 16), "base64");
  const validPng = signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return {
    branding,
    imageDataUrl: validPng ? `data:image/png;base64,${row.originalPng}` : null,
  };
}

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  imageData: z.string().max(Math.ceil(BRAND_IMAGE_MAX_BYTES * 4 / 3) + 64, "PNG muito grande. Limite de 5 MB."),
});

export async function saveBranding(user: SessionUser, raw: unknown) {
  if (user.role !== "admin") throw new ApiError(403, "Apenas o administrador pode alterar a identidade visual.");
  const { name, imageData } = uploadSchema.parse(raw);
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(imageData);
  if (!match) throw new ApiError(400, "Selecione o arquivo original em PNG.");
  const original = Buffer.from(match[1], "base64");
  if (original.length > BRAND_IMAGE_MAX_BYTES) throw new ApiError(413, "PNG muito grande. Limite de 5 MB.");
  if (!original.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new ApiError(400, "O arquivo não é um PNG válido.");
  const options = { limitInputPixels: BRAND_IMAGE_MAX_SIDE ** 2, failOn: "warning" as const };
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try { meta = await sharp(original, options).metadata(); }
  catch { throw new ApiError(400, "Não foi possível ler o PNG. Use o arquivo original, com até 4096 × 4096 pixels."); }
  if (!meta.width || !meta.height || meta.width > BRAND_IMAGE_MAX_SIDE || meta.height > BRAND_IMAGE_MAX_SIDE || (meta.pages ?? 1) > 1) {
    throw new ApiError(400, "Use um PNG estático de até 4096 × 4096 pixels.");
  }
  // Sem crop, sharpen, tint, máscara ou mudança da proporção. O original não passa pelo Sharp.
  async function icon(size: number) {
    return sharp(original, options).resize({
      width: size, height: size, fit: "contain", kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).keepIccProfile().png({ compressionLevel: 9, palette: false }).toBuffer();
  }
  let icons: Buffer[];
  try { icons = await Promise.all([icon(16), icon(32), icon(180)]); }
  catch { throw new ApiError(400, "O PNG está incompleto ou corrompido. Selecione o original novamente."); }
  const version = createHash("sha256").update(original).digest("hex");
  const values = {
    originalPng: original.toString("base64"), originalName: name, width: meta.width, height: meta.height, version,
    icon16: icons[0].toString("base64"), icon32: icons[1].toString("base64"), apple180: icons[2].toString("base64"),
    updatedAt: new Date(), updatedByName: user.name,
  };
  await db.insert(siteBranding).values({ id: KEY, ...values }).onConflictDoUpdate({ target: siteBranding.id, set: values });
  return { ok: true, version };
}

export async function deleteBranding(user: SessionUser) {
  if (user.role !== "admin") throw new ApiError(403, "Apenas o administrador pode alterar a identidade visual.");
  await db.delete(siteBranding).where(eq(siteBranding.id, KEY));
  return { ok: true };
}

export const BRAND_ASSETS = {
  "cosmic-cat.png": "originalPng",
  "favicon-16x16.png": "icon16",
  "favicon-32x32.png": "icon32",
  "apple-touch-icon.png": "apple180",
} as const;

export async function getBrandingAsset(asset: keyof typeof BRAND_ASSETS) {
  if (!hasDatabaseUrl) return null;
  try {
    const column = BRAND_ASSETS[asset];
    const [row] = await db.select({ data: siteBranding[column], version: siteBranding.version }).from(siteBranding).where(eq(siteBranding.id, KEY));
    return row ? { data: Buffer.from(row.data, "base64"), version: row.version } : null;
  } catch (e) {
    if (isSchemaMissing(e)) return null;
    throw e;
  }
}
