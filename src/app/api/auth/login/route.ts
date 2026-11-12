import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ApiError, handle, readBody } from "@/lib/api";
import { createSession, hashPassword, verifyPassword } from "@/lib/auth";
import { ensureReady } from "@/lib/seed";

const schema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Informe o e-mail.").max(200),
  password: z.string().min(1, "Informe a senha.").max(200),
});

// Hash descartável: mantém o tempo de resposta parecido quando o e-mail não existe.
const DUMMY_HASH = hashPassword("senha-inexistente");

export const POST = handle(async (req) => {
  const state = await ensureReady();
  if (!state.ok) throw new ApiError(503, "O sistema ainda não foi inicializado. Recarregue a página para ver os detalhes.");

  const { email, password } = await readBody(req, schema);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const valid = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid || !user.active) throw new ApiError(401, "E-mail ou senha incorretos.");

  const token = await createSession(user.id);
  // O navegador guarda este token e o envia em `Authorization`, o que mantém a
  // sessão funcionando mesmo quando cookies de terceiros são bloqueados.
  return { ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } };
});
