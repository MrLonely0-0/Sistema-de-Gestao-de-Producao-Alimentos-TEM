import { handle, requireUser } from "@/lib/api";
import { getStockManage } from "@/lib/queries";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  await requireUser(req);
  return getStockManage();
});
