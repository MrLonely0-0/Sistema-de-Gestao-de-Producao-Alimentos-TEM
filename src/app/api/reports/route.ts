import { z } from "zod";
import { handle, requireUser } from "@/lib/api";
import { STATUSES, type ReportFilters } from "@/lib/domain";
import { getReports } from "@/lib/queries";

export const dynamic = "force-dynamic";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .nullish()
  .transform((v) => v || null);

export const reportFiltersSchema = z.object({
  from: date,
  to: date,
  brand: z.string().max(40).nullish().transform((v) => v || null),
  productId: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  status: z.enum(STATUSES).nullish().transform((v) => v ?? null),
  includeDeleted: z
    .string()
    .nullish()
    .transform((v) => v === "1" || v === "true"),
});

export function parseReportFilters(url: URL): ReportFilters {
  const parsed = reportFiltersSchema.parse({
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
    brand: url.searchParams.get("brand"),
    productId: url.searchParams.get("productId"),
    status: url.searchParams.get("status"),
    includeDeleted: url.searchParams.get("includeDeleted"),
  });
  if (parsed.from && parsed.to && parsed.from > parsed.to) {
    parsed.from = null;
    parsed.to = null;
  }
  return parsed;
}

export const GET = handle(async (req) => {
  await requireUser(req);
  return getReports(parseReportFilters(req.nextUrl));
});
