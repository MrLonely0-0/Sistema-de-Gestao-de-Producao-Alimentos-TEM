import { z } from "zod";
import { db } from "@/db";
import { appState } from "@/db/schema";
import { ApiError, handle, readJson, requireAdmin } from "@/lib/api";
import { ADMIN_CAPABILITIES, hasAdminCapability, isMasterAdmin } from "@/lib/domain";

const settingsSchema = z
  .object({
    allowMultiFormatBatch: z.boolean().optional(),
    adminLimits: z
      .object({
        capabilities: z.array(z.enum(ADMIN_CAPABILITIES)),
      })
      .optional(),
  })
  .refine((v) => v.allowMultiFormatBatch !== undefined || v.adminLimits !== undefined, {
    message: "Informe ao menos uma configuração para atualizar.",
  });

export const PATCH = handle(async (req) => {
  const user = await requireAdmin(req);
  const data = settingsSchema.parse(await readJson(req));

  if (data.adminLimits !== undefined && !isMasterAdmin(user.role)) {
    throw new ApiError(403, "Apenas o Administrador Master pode definir limitações do administrador normal.");
  }
  if (
    data.allowMultiFormatBatch !== undefined &&
    !isMasterAdmin(user.role) &&
    !hasAdminCapability(user, "admin_produtos") &&
    !hasAdminCapability(user, "admin_paineis")
  ) {
    throw new ApiError(403, "Seu perfil de administrador não tem permissão para alterar esta opção.");
  }

  const normalizedLimits = data.adminLimits
    ? { capabilities: [...new Set(data.adminLimits.capabilities)] }
    : undefined;

  await db
    .insert(appState)
    .values({
      id: "lifecycle",
      ...(data.allowMultiFormatBatch !== undefined ? { allowMultiFormatBatch: data.allowMultiFormatBatch } : {}),
      ...(normalizedLimits !== undefined ? { adminLimits: normalizedLimits } : {}),
    })
    .onConflictDoUpdate({
      target: appState.id,
      set: {
        ...(data.allowMultiFormatBatch !== undefined ? { allowMultiFormatBatch: data.allowMultiFormatBatch } : {}),
        ...(normalizedLimits !== undefined ? { adminLimits: normalizedLimits } : {}),
      },
    });

  return {
    ok: true,
    ...(data.allowMultiFormatBatch !== undefined ? { allowMultiFormatBatch: data.allowMultiFormatBatch } : {}),
    ...(normalizedLimits !== undefined ? { adminLimits: normalizedLimits } : {}),
  };
});
