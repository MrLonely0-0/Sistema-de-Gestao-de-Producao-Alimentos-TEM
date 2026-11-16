import { z } from "zod";
import { db } from "@/db";
import { appState } from "@/db/schema";
import { handle, readJson, requireAdmin } from "@/lib/api";

const settingsSchema = z.object({
  allowMultiFormatBatch: z.boolean(),
});

export const PATCH = handle(async (req) => {
  await requireAdmin(req);
  const { allowMultiFormatBatch } = settingsSchema.parse(await readJson(req));
  await db
    .insert(appState)
    .values({ id: "lifecycle", allowMultiFormatBatch })
    .onConflictDoUpdate({
      target: appState.id,
      set: { allowMultiFormatBatch },
    });
  return { ok: true, allowMultiFormatBatch };
});
