import { handle, readJson, requireAdmin } from "@/lib/api";
import { clearDemo, getDemoOverview } from "@/lib/demo-service";

export const dynamic = "force-dynamic";
export const GET = handle(async (req) => getDemoOverview(await requireAdmin(req)));
export const POST = handle(async (req) => {
  const user = await requireAdmin(req);
  return clearDemo(user, await readJson(req));
});
