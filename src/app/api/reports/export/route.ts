import { z } from "zod";
import { ApiError, resolveSessionFromRequest } from "@/lib/api";
import { isReadOnly, type ReportDataset } from "@/lib/domain";
import { exportContent } from "@/lib/report-export";
import { getReports } from "@/lib/queries";
import { parseReportFilters } from "../route";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  dataset: z.enum(["bateladas", "producao", "estoque", "expedicoes", "qualidade", "completo"]),
  format: z.enum(["csv", "json"]),
});

export async function GET(req: Request) {
  try {
    const { user } = await resolveSessionFromRequest(req);
    if (!user) throw new ApiError(401, "Sua sessão expirou. Entre novamente.");
    if (isReadOnly(user.role)) {
      throw new ApiError(403, "Exportação desabilitada no modo visualização (somente leitura).");
    }
    const url = new URL(req.url);
    const { dataset, format } = querySchema.parse({
      dataset: url.searchParams.get("dataset") ?? "completo",
      format: url.searchParams.get("format") ?? "csv",
    });
    const data = await getReports(parseReportFilters(url));
    const { filename, mime, content } = exportContent(dataset as ReportDataset | "completo", format, data);
    return new Response(content, {
      headers: {
        "content-type": mime,
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Não foi possível gerar o arquivo.";
    const status = e instanceof ApiError ? e.status : e instanceof z.ZodError ? 400 : 500;
    return Response.json({ error: status === 500 ? "Não foi possível gerar o arquivo." : message }, { status });
  }
}
