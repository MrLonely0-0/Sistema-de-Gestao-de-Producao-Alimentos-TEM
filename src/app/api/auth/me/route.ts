import { handle, requestToken } from "@/lib/api";
import { getUserByToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Quem está logado. Aceita o token em qualquer canal: Authorization,
 * x-tem-session, query `?t=` ou cookie — é esta rota que decide se o painel
 * abre, então ela precisa ser a mais tolerante de todas.
 */
export const GET = handle(async (req) => {
  const user = await getUserByToken(requestToken(req));
  return { user };
});
