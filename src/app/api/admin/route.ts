import { handle, requireAdmin } from "@/lib/api";
import { getAdminOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireAdmin(req);
  return getAdminOverview();
});
