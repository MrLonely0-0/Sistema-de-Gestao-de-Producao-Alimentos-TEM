import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { AttachmentKind, ColumnFeature, Role, Status } from "../lib/domain";

const ts = (name: string) => timestamp(name, { withTimezone: true });

/* ───────────── Classificação dinâmica de produtos ─────────────
 * "Tipo de separação" = dimensão (Marca, Família, Grupo…). O gestor pode
 * criar, renomear e excluir dimensões e seus valores livremente.
 */
export const productDimensions = pgTable("product_dimensions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const productDimensionValues = pgTable(
  "product_dimension_values",
  {
    id: serial("id").primaryKey(),
    dimensionId: integer("dimension_id")
      .notNull()
      .references(() => productDimensions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dimension_values_dimension_name_uq").on(t.dimensionId, t.name)],
);

export const productClassifications = pgTable(
  "product_classifications",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    dimensionId: integer("dimension_id")
      .notNull()
      .references(() => productDimensions.id, { onDelete: "cascade" }),
    valueId: integer("value_id")
      .notNull()
      .references(() => productDimensionValues.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("product_classifications_uq").on(t.productId, t.dimensionId)],
);

/* ───────────── Acesso (RBAC) ───────────── */

/** Perfil de acesso personalizado: um papel-base + permissões extras. */
export const accessProfiles = pgTable("access_profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  baseRole: text("base_role").$type<Role>().notNull(),
  grants: jsonb("grants").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").$type<Role>().notNull(),
  profileId: integer("profile_id").references(() => accessProfiles.id, { onDelete: "set null" }),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Configurações editáveis pelo administrador (ex.: nome da aba de chat). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Chat interno entre colaboradores. Mensagens são apenas acrescentadas. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name").notNull(),
    userRole: text("user_role").$type<Role>(),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("chat_messages_id_idx").on(t.id)],
);

export const sessions = pgTable("sessions", {
  // Guardamos apenas o SHA-256 do token; o token em si só existe no cookie.
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ───────────── Painéis do quadro (colunas configuráveis) ───────────── */

export const kanbanColumns = pgTable("kanban_columns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  subtitle: text("subtitle").notNull().default(""),
  /** Classe de cor do tema: prod | qual | acab | ink | hivis. */
  accent: text("accent").notNull().default("ink"),
  /** Posição no quadro (menor = mais à esquerda). */
  position: integer("position").notNull().default(0),
  role: text("role").$type<Role>().notNull(),
  /** Status cujos cards aparecem nesta coluna. */
  statuses: jsonb("statuses").$type<Status[]>().notNull(),
  /** Funcionalidades habilitadas nesta coluna. */
  features: jsonb("features").$type<ColumnFeature[]>().notNull(),
  showStock: boolean("show_stock").notNull().default(false),
  active: boolean("active").notNull().default(true),
  deletedAt: ts("deleted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ───────────── Ajustes de estoque (entradas/saídas avulsas) ───────────── */

export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: serial("id").primaryKey(),
    packagingOptionId: integer("packaging_option_id")
      .notNull()
      .references(() => packagingOptions.id),
    /** Positivo = entrada, negativo = saída/baixa. */
    boxes: integer("boxes").notNull(),
    reason: text("reason").notNull(),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    deletedByName: text("deleted_by_name"),
  },
  (t) => [index("stock_adjustments_option_idx").on(t.packagingOptionId)],
);

/* ───────────── Cadastro (De-Para) ───────────── */

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    brand: text("brand").notNull(),
    format: text("format").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    // Contador da numeração sequencial de bateladas deste item (#1, #2…).
    batchCounter: integer("batch_counter").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    deletedByName: text("deleted_by_name"),
  },
  (t) => [uniqueIndex("products_brand_format_uq").on(t.brand, t.format)],
);

export const packagingOptions = pgTable(
  "packaging_options",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    unitsPerBox: integer("units_per_box").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("packaging_product_label_units_uq").on(t.productId, t.label, t.unitsPerBox)],
);

/* ───────────── Fluxo produtivo ───────────── */

export const batches = pgTable(
  "batches",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    number: integer("number").notNull(),
    // Cópia da marca/formato no momento da produção (rastreabilidade).
    brand: text("brand").notNull(),
    format: text("format").notNull(),
    status: text("status").$type<Status>().notNull().default("em_preparo"),

    garlicLot: text("garlic_lot"),
    preservativeLot: text("preservative_lot"),
    mixStart: ts("mix_start"),
    mixEnd: ts("mix_end"),
    fillStart: ts("fill_start"),
    fillEnd: ts("fill_end"),
    finishStart: ts("finish_start"),
    finishEnd: ts("finish_end"),
    goodUnits: integer("good_units"),
    lossUnits: integer("loss_units"),
    notes: text("notes"),

    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    readyAt: ts("ready_at"),

    // Carimbo de liberação: gravado uma única vez e travado por trigger no banco.
    releasedAt: ts("released_at"),
    releasedById: integer("released_by_id").references(() => users.id, { onDelete: "set null" }),
    releasedByName: text("released_by_name"),

    // Último parecer da Qualidade (motivo de retenção ou de devolução).
    qualityNote: text("quality_note"),
    heldAt: ts("held_at"),

    finishedAt: ts("finished_at"),
    finishedByName: text("finished_by_name"),

    driveFolderId: text("drive_folder_id"),
    driveFolderPath: text("drive_folder_path"),

    // Última pessoa que alterou este card e com qual perfil de acesso.
    lastChangedById: integer("last_changed_by_id").references(() => users.id, { onDelete: "set null" }),
    lastChangedByName: text("last_changed_by_name"),
    lastChangedByRole: text("last_changed_by_role").$type<Role>(),
    lastChangedAt: ts("last_changed_at"),

    deletedAt: ts("deleted_at"),
    deletedById: integer("deleted_by_id").references(() => users.id, { onDelete: "set null" }),
    deletedByName: text("deleted_by_name"),
  },
  (t) => [
    uniqueIndex("batches_product_number_uq").on(t.productId, t.number),
    index("batches_status_idx").on(t.status),
  ],
);

export const batchOutputs = pgTable(
  "batch_outputs",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    packagingOptionId: integer("packaging_option_id")
      .notNull()
      .references(() => packagingOptions.id),
    label: text("label").notNull(),
    unitsPerBox: integer("units_per_box").notNull(),
    boxes: integer("boxes").notNull(),
  },
  (t) => [uniqueIndex("batch_outputs_batch_option_uq").on(t.batchId, t.packagingOptionId)],
);

export const shipments = pgTable("shipments", {
  id: serial("id").primaryKey(),
  packagingOptionId: integer("packaging_option_id")
    .notNull()
    .references(() => packagingOptions.id),
  boxes: integer("boxes").notNull(),
  orderRef: text("order_ref").notNull(),
  customer: text("customer"),
  createdByName: text("created_by_name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AttachmentKind>().notNull(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdByName: text("created_by_name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("attachments_batch_idx").on(t.batchId)],
);

export const batchEvents = pgTable(
  "batch_events",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => batches.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    message: text("message").notNull(),
    userName: text("user_name").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    userRole: text("user_role").$type<Role>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("batch_events_batch_idx").on(t.batchId)],
);
