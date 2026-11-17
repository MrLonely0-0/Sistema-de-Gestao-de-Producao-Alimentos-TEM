import { handle, requireAdminRead } from "@/lib/api";
import { getAdminOverview } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireAdminRead(req);
  return getAdminOverview();
});
