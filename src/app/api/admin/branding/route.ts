import { ApiError, handle, readJson, requireAdmin, requireAdminRead } from "@/lib/api";
import { deleteBranding, getAdminBrandingState, saveBranding } from "@/lib/branding";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireAdminRead(req, "admin_visual");
  return getAdminBrandingState();
});

export const POST = handle(async (req) => {
  const user = await requireAdmin(req, "admin_visual");
  const size = Number(req.headers.get("content-length") ?? 0);
  if (size > 7_100_000) {
    throw new ApiError(413, "PNG muito grande. Limite de 5 MB.");
  }
  return saveBranding(user, await readJson(req));
});

export const DELETE = handle(async (req) => {
  const user = await requireAdmin(req, "admin_visual");
  return deleteBranding(user);
});
