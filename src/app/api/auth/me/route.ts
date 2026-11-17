import { handle, resolveSessionFromRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const { user, matchedToken, clientToken } = await resolveSessionFromRequest(req);
  return {
    user,
    clearClientToken: Boolean(clientToken && (!user || clientToken !== matchedToken)),
  };
});
