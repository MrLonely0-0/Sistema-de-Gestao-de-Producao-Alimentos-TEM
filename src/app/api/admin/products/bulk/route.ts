import { handle, readJson, requireAdmin } from "@/lib/api";
import { bulkUpdateProducts } from "@/lib/admin-service";

export const POST = handle(async (req) => {
  const user = await requireAdmin(req);
  return bulkUpdateProducts(user, await readJson(req));
});
