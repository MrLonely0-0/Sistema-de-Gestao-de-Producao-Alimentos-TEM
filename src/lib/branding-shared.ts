/** Somente constantes e contratos públicos — nenhum byte de imagem nem acesso ao banco no bundle. */
export const BRAND_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const BRAND_IMAGE_MAX_SIDE = 4096;
export const SPLASH_FADE_MS = 360;

export interface BrandingInfo {
  version: string;
  originalName: string;
  width: number;
  height: number;
  imageUrl: string;
  icon16Url: string;
  icon32Url: string;
  appleUrl: string;
  updatedAt: string;
  updatedByName: string;
}

export function brandAssetUrl(asset: string, version: string) {
  return `/brand/${asset}?v=${encodeURIComponent(version)}`;
}
