import { handle } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Verificador público de versão. Serve para confirmar que o navegador está
 * falando com o build atual, e não com um snapshot antigo da pré-visualização.
 */
export const GET = handle(async () => ({
  app: "Alimentos TEM · Gestão de Produção e Logística",
  version: "2026-11-11.1",
  modules: ["kanban", "relatorios", "estoque", "admin-classificacoes", "paineis-configuraveis"],
  serverTime: new Date().toISOString(),
  sandbox: process.env.E2B_SANDBOX_ID ?? "local",
  hint: "Se /estoque ou /api/version retornarem 404, este endereço é um snapshot antigo.",
}));
