import { randomBytes } from "node:crypto";

/**
 * Integração com Google Drive — implementação SIMULADA.
 *
 * Cada batelada nova recebe uma "pasta" com ID e caminho gerados aqui, e os
 * links de laudos/fotos ficam registrados na tabela `attachments`. Nenhuma
 * chamada sai para o Google.
 *
 * Para ligar o Drive de verdade, basta trocar o corpo de `createBatchFolder`
 * por uma chamada a `POST https://www.googleapis.com/drive/v3/files` com
 * `mimeType: application/vnd.google-apps.folder` (conta de serviço) e devolver
 * o `id` real e `url: https://drive.google.com/drive/folders/<id>`.
 * O restante do sistema só conhece esta interface.
 */

export const DRIVE_MODE = "simulado" as const;
export const DRIVE_ROOT = "Alimentos TEM / Bateladas";

export interface DriveFolder {
  id: string;
  path: string;
  /** null enquanto a integração é simulada (não existe pasta real para abrir). */
  url: string | null;
}

export async function createBatchFolder(input: { brand: string; format: string; number: number }): Promise<DriveFolder> {
  const id = `sim_${randomBytes(14).toString("base64url")}`;
  const path = `${DRIVE_ROOT} / ${input.brand} ${input.format} / Batelada #${input.number}`;
  return { id, path, url: null };
}
