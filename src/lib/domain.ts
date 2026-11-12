/**
 * Regras de domínio compartilhadas entre servidor e navegador.
 * O servidor é a autoridade (toda rota revalida); o navegador usa as mesmas
 * regras apenas para mostrar ou esconder ações.
 */

/* ───────────── Perfis ───────────── */

export const ROLES = ["admin", "producao", "qualidade", "acabamento", "logistica", "consulta"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  producao: "Operador de Produção",
  qualidade: "Inspetor de Qualidade",
  acabamento: "Operador de Acabamento",
  logistica: "Estoque e Logística",
  consulta: "Somente consulta",
};

/** Ações que um perfil personalizado pode receber além do papel-base. */
export const GRANTABLE_ACTIONS = [
  "criar",
  "editar",
  "marcar_pronto",
  "liberar",
  "reter",
  "devolver",
  "finalizar",
  "separar",
] as const;
export type GrantableAction = (typeof GRANTABLE_ACTIONS)[number];
export const GRANT_LABEL: Record<GrantableAction, string> = {
  criar: "Abrir novas bateladas",
  editar: "Editar dados de produção",
  marcar_pronto: "Marcar lote como Pronto",
  liberar: "Liberar lote (Qualidade)",
  reter: "Reter lote (Qualidade)",
  devolver: "Devolver lote à Produção",
  finalizar: "Definir caixas e finalizar",
  separar: "Separar pedidos e ajustar estoque",
};

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  /** Nome do perfil personalizado (null quando usa o papel padrão). */
  profileName: string | null;
  /** Permissões extras concedidas pelo perfil personalizado. */
  grants: GrantableAction[];
}

/* ───────────── Status e colunas ───────────── */

export const STATUSES = ["em_preparo", "pronto", "retido", "liberado", "em_estoque"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  em_preparo: "Em preparo",
  pronto: "Pronto",
  retido: "Retido",
  liberado: "Liberado",
  em_estoque: "Em estoque",
};

export const STAGES = ["producao", "qualidade", "acabamento", "estoque"] as const;
export type Stage = (typeof STAGES)[number];

/** Cada card fica na coluna de quem precisa agir sobre ele. */
export const STAGE_OF: Record<Status, Stage> = {
  em_preparo: "producao",
  pronto: "qualidade",
  retido: "qualidade",
  liberado: "acabamento",
  em_estoque: "estoque",
};

export const STAGE_META: Record<Stage, { title: string; subtitle: string; role: Role; empty: string }> = {
  producao: {
    title: "Produção",
    subtitle: "Entrada de bateladas",
    role: "producao",
    empty: "Nenhuma batelada em preparo.",
  },
  qualidade: {
    title: "Qualidade",
    subtitle: "Aprovação ou retenção",
    role: "qualidade",
    empty: "Nenhum lote aguardando inspeção.",
  },
  acabamento: {
    title: "Acabamento",
    subtitle: "Unidades em caixas",
    role: "acabamento",
    empty: "Nenhum lote liberado aguardando caixas.",
  },
  estoque: {
    title: "Estoque e Logística",
    subtitle: "Saldo para expedição",
    role: "logistica",
    empty: "Nenhuma batelada finalizada ainda.",
  },
};

/* ───────────── Painéis configuráveis ───────────── */

export const COLUMN_FEATURES = [
  "criar",
  "editar",
  "marcar_pronto",
  "liberar",
  "reter",
  "devolver",
  "finalizar",
  "separar",
  "anexar",
  "excluir",
] as const;
export type ColumnFeature = (typeof COLUMN_FEATURES)[number];

export const FEATURE_LABEL: Record<ColumnFeature, string> = {
  criar: "Abrir nova batelada",
  editar: "Editar dados de produção",
  marcar_pronto: "Marcar como Pronto",
  liberar: "Liberar lote",
  reter: "Reter lote",
  devolver: "Devolver à Produção",
  finalizar: "Definir caixas e finalizar",
  separar: "Separar pedido / gerenciar estoque",
  anexar: "Anexar laudos e fotos",
  excluir: "Excluir batelada",
};

export const ACCENTS = ["prod", "qual", "acab", "ink", "hivis", "ok", "stop"] as const;
export type Accent = (typeof ACCENTS)[number];

export const ACCENT_LABEL: Record<Accent, string> = {
  prod: "Laranja · Produção",
  qual: "Azul · Qualidade",
  acab: "Verde · Acabamento",
  ink: "Preto · Estoque",
  hivis: "Amarelo",
  ok: "Verde · Aprovado",
  stop: "Vermelho · Atenção",
};

export interface ColumnDTO {
  id: number;
  name: string;
  subtitle: string;
  accent: Accent;
  position: number;
  role: Role;
  statuses: Status[];
  features: ColumnFeature[];
  showStock: boolean;
  active: boolean;
  cardCount: number;
}

export function columnsForStatus(columns: ColumnDTO[], status: Status): ColumnDTO[] {
  return columns.filter((c) => c.active && c.statuses.includes(status));
}

/** A funcionalidade está ligada na coluna que contém este status? */
export function featureOn(columns: ColumnDTO[], feature: ColumnFeature, status?: Status): boolean {
  const relevant = status
    ? columnsForStatus(columns, status)
    : feature === "separar"
      ? columns.filter((c) => c.active && c.showStock)
      : columns.filter((c) => c.active && c.statuses.includes("em_preparo"));
  return relevant.length === 0 || relevant.some((c) => c.features.includes(feature));
}

/* ───────────── Permissões (RBAC) ───────────── */

export type TransitionAction = "marcar_pronto" | "liberar" | "reter" | "devolver" | "finalizar";
export type Action = TransitionAction | "criar" | "editar" | "separar";

export const ACTION_ROLE: Record<Action, Role> = {
  criar: "producao",
  editar: "producao",
  marcar_pronto: "producao",
  liberar: "qualidade",
  reter: "qualidade",
  devolver: "qualidade",
  finalizar: "acabamento",
  separar: "logistica",
};

export const ACTION_LABEL: Record<Action, string> = {
  criar: "Criar batelada",
  editar: "Editar dados de produção",
  marcar_pronto: "Marcar como Pronto",
  liberar: "Liberar lote",
  reter: "Reter lote",
  devolver: "Devolver à Produção",
  finalizar: "Definir caixas e enviar ao estoque",
  separar: "Separar pedido para expedição",
};

export const TRANSITIONS: Record<TransitionAction, { from: Status[]; to: Status }> = {
  marcar_pronto: { from: ["em_preparo"], to: "pronto" },
  liberar: { from: ["pronto", "retido"], to: "liberado" },
  reter: { from: ["pronto"], to: "retido" },
  devolver: { from: ["pronto", "retido"], to: "em_preparo" },
  finalizar: { from: ["liberado"], to: "em_estoque" },
};

export function can(role: Role, action: Action): boolean {
  return role === "admin" || ACTION_ROLE[action] === role;
}

/** Permissão efetiva: papel padrão OU permissão extra do perfil personalizado. */
export function canUser(user: Pick<SessionUser, "role" | "grants">, action: Action): boolean {
  if (can(user.role, action)) return true;
  return (user.grants as string[]).includes(action);
}

export const ATTACHMENT_KINDS = ["laudo", "foto"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

/** Anexos: a Qualidade pode anexar sempre; os demais só enquanto o card está na sua coluna. */
export function canAttach(role: Role, status: Status): boolean {
  if (role === "admin" || role === "qualidade") return true;
  return STAGE_META[STAGE_OF[status]].role === role && role !== "logistica" && role !== "consulta";
}

/* ───────────── Checklist para marcar "Pronto" ───────────── */

type Moment = string | Date | null | undefined;

export interface ProductionData {
  garlicLot: string | null;
  preservativeLot: string | null;
  mixStart: Moment;
  mixEnd: Moment;
  fillStart: Moment;
  fillEnd: Moment;
  finishStart: Moment;
  finishEnd: Moment;
  goodUnits: number | null;
  lossUnits: number | null;
}

export const PROCESS_STEPS = [
  { key: "mix", label: "Mistura", start: "mixStart", end: "mixEnd" },
  { key: "fill", label: "Envase", start: "fillStart", end: "fillEnd" },
  { key: "finish", label: "Acabamento", start: "finishStart", end: "finishEnd" },
] as const;

const ms = (m: Moment) => (m ? new Date(m).getTime() : null);

/** Erros de consistência que impedem até mesmo salvar. */
export function timeOrderErrors(d: ProductionData): string[] {
  const errors: string[] = [];
  for (const step of PROCESS_STEPS) {
    const a = ms(d[step.start]);
    const b = ms(d[step.end]);
    if (a !== null && b !== null && b < a) {
      errors.push(`O fim de ${step.label.toLowerCase()} não pode ser anterior ao início.`);
    }
  }
  return errors;
}

export const READY_TOTAL = 10;

/** Campos que ainda faltam para a batelada poder ir para "Pronto". */
export function missingForReady(d: ProductionData): string[] {
  const missing: string[] = [];
  if (!d.garlicLot) missing.push("Lote de alho");
  if (!d.preservativeLot) missing.push("Lote de conservante");
  for (const step of PROCESS_STEPS) {
    if (!d[step.start]) missing.push(`Início de ${step.label.toLowerCase()}`);
    if (!d[step.end]) missing.push(`Fim de ${step.label.toLowerCase()}`);
  }
  if (d.goodUnits === null || d.goodUnits === undefined || d.goodUnits < 1) missing.push("Unidades boas");
  if (d.lossUnits === null || d.lossUnits === undefined) missing.push("Perdas");
  return missing;
}

/* ───────────── DTOs (contratos da API) ───────────── */

export interface PackagingDTO {
  id: number;
  label: string;
  unitsPerBox: number;
  active: boolean;
}

export interface DimensionValueDTO {
  id: number;
  dimensionId: number;
  name: string;
  active: boolean;
  productCount: number;
}

export interface DimensionDTO {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  /** A dimensão "Marca" alimenta products.brand e as etiquetas do painel. */
  isBrand: boolean;
  values: DimensionValueDTO[];
}

export interface ProductDTO {
  id: number;
  brand: string;
  format: string;
  description: string | null;
  active: boolean;
  nextNumber: number;
  packaging: PackagingDTO[];
  /** dimensionId → valueId (null quando o produto não foi classificado). */
  classifications: Record<number, number | null>;
}

export interface OutputDTO {
  packagingOptionId: number;
  label: string;
  unitsPerBox: number;
  boxes: number;
}

export interface BatchDTO {
  id: number;
  productId: number;
  number: number;
  brand: string;
  format: string;
  status: Status;
  garlicLot: string | null;
  preservativeLot: string | null;
  mixStart: string | null;
  mixEnd: string | null;
  fillStart: string | null;
  fillEnd: string | null;
  finishStart: string | null;
  finishEnd: string | null;
  goodUnits: number | null;
  lossUnits: number | null;
  notes: string | null;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
  releasedAt: string | null;
  releasedByName: string | null;
  qualityNote: string | null;
  heldAt: string | null;
  finishedAt: string | null;
  finishedByName: string | null;
  driveFolderId: string | null;
  driveFolderPath: string | null;
  lastChangedById: number | null;
  lastChangedByName: string | null;
  lastChangedByRole: Role | null;
  lastChangedAt: string | null;
  outputs: OutputDTO[];
  attachmentCount: number;
}

export interface AttachmentDTO {
  id: number;
  kind: AttachmentKind;
  name: string;
  url: string;
  createdById: number | null;
  createdByName: string;
  createdAt: string;
}

export interface EventDTO {
  id: number;
  type: string;
  message: string;
  userName: string;
  userId: number | null;
  userRole: Role | null;
  createdAt: string;
}

export interface BatchDetailDTO extends BatchDTO {
  attachments: AttachmentDTO[];
  events: EventDTO[];
}

export interface StockRowDTO {
  packagingOptionId: number;
  productId: number;
  brand: string;
  format: string;
  label: string;
  unitsPerBox: number;
  produced: number;
  adjusted: number;
  shipped: number;
  balance: number;
}

export interface AdjustmentDTO {
  id: number;
  packagingOptionId: number;
  productId: number;
  brand: string;
  format: string;
  label: string;
  unitsPerBox: number;
  boxes: number;
  reason: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface StockManageDTO {
  rows: StockRowDTO[];
  adjustments: AdjustmentDTO[];
  shipments: ShipmentDTO[];
  products: Array<{ id: number; brand: string; format: string; packaging: PackagingDTO[] }>;
}

export interface ShipmentDTO {
  id: number;
  brand: string;
  format: string;
  label: string;
  boxes: number;
  orderRef: string;
  customer: string | null;
  createdByName: string;
  createdAt: string;
}

export interface BoardDTO {
  columns: ColumnDTO[];
  batches: BatchDTO[];
  products: ProductDTO[];
  stock: StockRowDTO[];
  shipments: ShipmentDTO[];
  stockedTotal: number;
}

export interface AdminUserDTO {
  id: number;
  name: string;
  email: string;
  role: Role;
  profileId: number | null;
  profileName: string | null;
  active: boolean;
  createdAt: string;
}

export interface AccessProfileDTO {
  id: number;
  name: string;
  description: string;
  baseRole: Role;
  grants: GrantableAction[];
  active: boolean;
  userCount: number;
}

export interface DriveFolderDTO {
  batchId: number;
  title: string;
  path: string;
  folderId: string;
  attachments: number;
  createdAt: string;
}

export const BRAND_SLUG = "marca";

/* ───────────── Relatórios e exportação ───────────── */

export type ReportDataset = "bateladas" | "producao" | "estoque" | "expedicoes" | "qualidade";
export const REPORT_DATASETS: Array<{ id: ReportDataset; label: string; description: string }> = [
  { id: "bateladas", label: "Bateladas", description: "Uma linha por batelada, com todos os dados e carimbos" },
  { id: "producao", label: "Produção por produto", description: "Unidades, perdas, rendimento e caixas agrupados por item" },
  { id: "estoque", label: "Saldo de estoque", description: "Caixas produzidas, expedidas e saldo por embalagem" },
  { id: "expedicoes", label: "Expedições", description: "Cada separação de pedido, com cliente e responsável" },
  { id: "qualidade", label: "Qualidade", description: "Liberações, retenções e tempos de cada lote" },
];

export interface ReportFilters {
  from: string | null;
  to: string | null;
  brand: string | null;
  productId: number | null;
  status: Status | null;
  includeDeleted: boolean;
}

export interface ReportBatchRow extends BatchDTO {
  family: string | null;
  groupName: string | null;
  deleted: boolean;
  producedBoxes: number;
  usedUnits: number;
  yieldPct: number | null;
  leadToReleaseHours: number | null;
}

export interface ReportProductRow {
  productId: number;
  brand: string;
  format: string;
  batches: number;
  goodUnits: number;
  lossUnits: number;
  yieldPct: number | null;
  boxes: number;
  released: number;
  retained: number;
}

export interface ReportQualityRow {
  batchId: number;
  number: number;
  brand: string;
  format: string;
  status: Status;
  readyAt: string | null;
  releasedAt: string | null;
  releasedByName: string | null;
  heldAt: string | null;
  qualityNote: string | null;
  leadHours: number | null;
}

export interface ReportDayPoint {
  day: string;
  label: string;
  batches: number;
  goodUnits: number;
  boxes: number;
}

export interface ReportsDTO {
  filters: ReportFilters;
  generatedAt: string;
  kpis: {
    batches: number;
    goodUnits: number;
    lossUnits: number;
    yieldPct: number | null;
    boxes: number;
    adjustedBoxes: number;
    shipped: number;
    balance: number;
    released: number;
    retained: number;
    avgReleaseHours: number | null;
    attachments: number;
  };
  series: ReportDayPoint[];
  statusBreakdown: Array<{ status: Status; count: number }>;
  batches: ReportBatchRow[];
  products: ReportProductRow[];
  stock: StockRowDTO[];
  shipments: ShipmentDTO[];
  quality: ReportQualityRow[];
  brands: string[];
  productsCatalog: Array<{ id: number; brand: string; format: string }>;
  totalAttachments: number;
}

export interface AdminOverviewDTO {
  users: AdminUserDTO[];
  profiles: AccessProfileDTO[];
  chatTitle: string;
  products: ProductDTO[];
  dimensions: DimensionDTO[];
  columns: ColumnDTO[];
  drive: {
    mode: "simulado";
    root: string;
    totalFolders: number;
    totalAttachments: number;
    folders: DriveFolderDTO[];
  };
}
