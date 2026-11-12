import { handle, requireUser } from "@/lib/api";
import { getBoard } from "@/lib/queries";

export const dynamic = "force-dynamic";

// Todos os perfis enxergam o painel inteiro; as ações é que são restritas.
export const GET = handle(async (req) => {
  await requireUser(req);
  return getBoard();
});
