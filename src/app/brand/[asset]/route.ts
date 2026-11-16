import type { NextRequest } from "next/server";
import { BRAND_ASSETS, getBrandingAsset } from "@/lib/branding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Recursos gráficos públicos; a publicação da imagem exige Admin. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  if (!Object.hasOwn(BRAND_ASSETS, asset)) return new Response(null, { status: 404 });
  const image = await getBrandingAsset(asset as keyof typeof BRAND_ASSETS);
  if (!image || image.data.length === 0) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  const etag = `"${image.version}-${asset}"`;
  const headers = {
    "content-type": "image/png",
    "cache-control": "public, max-age=3600, must-revalidate",
    "x-content-type-options": "nosniff",
    etag,
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(image.data), { headers });
}
