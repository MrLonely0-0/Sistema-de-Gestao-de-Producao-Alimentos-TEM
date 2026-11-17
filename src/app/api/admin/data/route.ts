import { handle, readJson, requireAdmin, requireAdminRead } from "@/lib/api";
import { clearDemo, getDemoOverview } from "@/lib/demo-service";

export const dynamic = "force-dynamic";
export const GET = handle(async (req) => getDemoOverview(await requireAdminRead(req, "admin_dados")));
export const POST = handle(async (req) => {
  const user = await requireAdmin(req, "admin_dados");
  return clearDemo(user, await readJson(req));
});
