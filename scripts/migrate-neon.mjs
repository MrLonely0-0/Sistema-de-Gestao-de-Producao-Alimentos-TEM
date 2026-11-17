/**
 * Migração idempotente e não destrutiva para bancos PostgreSQL (Neon) existentes.
 * Converte schemas antigos (versão inicial `a4b10ae`, dump intermediário ou Opção A)
 * para o formato atual antes de executar `npx drizzle-kit push`.
 *
 * Uso: npm run db:migrate && npx drizzle-kit push
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import sharp from "sharp";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error("Defina DATABASE_URL antes de executar npm run db:migrate.");
  process.exit(1);
}

const VALID_ACTIONS = new Set([
  "criar",
  "editar",
  "marcar_pronto",
  "liberar",
  "reter",
  "devolver",
  "finalizar",
  "separar",
  "anexar",
]);

const ROLE_DEFAULT_ACTIONS = {
  admin: [...VALID_ACTIONS],
  producao: ["criar", "editar", "marcar_pronto"],
  qualidade: ["liberar", "reter", "devolver", "anexar"],
  acabamento: ["finalizar"],
  logistica: ["separar"],
};

const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 15_000 });

async function tableExists(client, table) {
  const { rows } = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`]);
  return Boolean(rows[0]?.reg);
}

async function columnExists(client, table, column) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(7405103)");

    // 1) Migrar perfis personalizados antigos (`base_role` + `grants` -> `permissions`)
    if ((await tableExists(client, "access_profiles")) && !(await columnExists(client, "access_profiles", "permissions"))) {
      console.log("• Migrando access_profiles (base_role/grants → permissions)...");
      await client.query(`
        ALTER TABLE public.access_profiles
          ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
          ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
          ADD COLUMN IF NOT EXISTS deleted_by_name text
      `);
      if (await columnExists(client, "access_profiles", "base_role")) {
        const { rows } = await client.query(`SELECT id, base_role, grants FROM public.access_profiles`);
        for (const r of rows) {
          const base = ROLE_DEFAULT_ACTIONS[r.base_role] ?? [];
          const extra = Array.isArray(r.grants) ? r.grants : [];
          const merged = [...new Set([...base, ...extra])].filter((a) => VALID_ACTIONS.has(a));
          await client.query(`UPDATE public.access_profiles SET permissions = $1::jsonb WHERE id = $2`, [
            JSON.stringify(merged),
            r.id,
          ]);
        }
        await client.query(`ALTER TABLE public.access_profiles DROP COLUMN IF EXISTS base_role, DROP COLUMN IF EXISTS grants`);
      }
    }

    // 2) Migrar chat legado (`user_name`, `user_role`, `body` -> canais + `channel_id`, `author_name`, ...)
    if ((await tableExists(client, "chat_messages")) && !(await columnExists(client, "chat_messages", "channel_id"))) {
      console.log("• Migrando chat_messages legado para canais...");
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.chat_channels (
          id serial PRIMARY KEY,
          name text NOT NULL UNIQUE,
          description text,
          kind text NOT NULL DEFAULT 'channel',
          active boolean NOT NULL DEFAULT true,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      for (const name of ["Geral", "Produção", "Qualidade", "Logística"]) {
        await client.query(`INSERT INTO public.chat_channels (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
      }
      const { rows: channels } = await client.query(`SELECT id FROM public.chat_channels WHERE name = 'Geral' LIMIT 1`);
      const geralId = channels[0].id;

      await client.query(`
        ALTER TABLE public.chat_messages
          ADD COLUMN IF NOT EXISTS channel_id integer,
          ADD COLUMN IF NOT EXISTS author_name text,
          ADD COLUMN IF NOT EXISTS author_role text,
          ADD COLUMN IF NOT EXISTS content text,
          ADD COLUMN IF NOT EXISTS image_data text,
          ADD COLUMN IF NOT EXISTS image_name text,
          ADD COLUMN IF NOT EXISTS edited_at timestamptz,
          ADD COLUMN IF NOT EXISTS deleted_at timestamptz
      `);

      await client.query(
        `UPDATE public.chat_messages SET
          channel_id = COALESCE(channel_id, $1),
          author_name = COALESCE(author_name, user_name, 'Colaborador'),
          author_role = COALESCE(author_role, user_role, 'producao'),
          content = COALESCE(content, body, '')`,
        [geralId],
      );

      await client.query(`
        ALTER TABLE public.chat_messages
          ALTER COLUMN channel_id SET NOT NULL,
          ALTER COLUMN author_name SET NOT NULL,
          ALTER COLUMN author_role SET NOT NULL,
          ALTER COLUMN content SET NOT NULL,
          ALTER COLUMN content SET DEFAULT ''
      `);
      await client.query(`
        ALTER TABLE public.chat_messages
          DROP COLUMN IF EXISTS user_name,
          DROP COLUMN IF EXISTS user_role,
          DROP COLUMN IF EXISTS body
      `);
    }

    // 3) Remover tabela obsoleta app_settings (era apenas título do chat antes dos canais)
    if (await tableExists(client, "app_settings")) {
      console.log("• Removendo tabela obsoleta app_settings...");
      await client.query(`DROP TABLE IF EXISTS public.app_settings`);
    }

    // 4) Migrar dados da Opção A se existirem: stock_items -> inventory_items
    if ((await tableExists(client, "stock_items")) && !(await tableExists(client, "inventory_items"))) {
      console.log("• Migrando stock_items → inventory_items...");
      await client.query(`
        CREATE TABLE public.inventory_items (
          id serial PRIMARY KEY,
          packaging_option_id integer NOT NULL UNIQUE REFERENCES public.packaging_options(id),
          name text,
          location text,
          notes text,
          source text NOT NULL,
          revision integer NOT NULL DEFAULT 1,
          created_by_name text NOT NULL,
          updated_by_name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          deleted_at timestamptz,
          deleted_by_name text
        )
      `);
      await client.query(`
        INSERT INTO public.inventory_items (
          id, packaging_option_id, name, notes, source, revision,
          created_by_name, updated_by_name, created_at, updated_at, deleted_at, deleted_by_name
        )
        SELECT
          id,
          packaging_option_id,
          display_name,
          notes,
          CASE WHEN origin IN ('manual', 'production', 'import') THEN origin ELSE 'import' END,
          1,
          created_by_name,
          updated_by_name,
          created_at,
          updated_at,
          deleted_at,
          deleted_by_name
        FROM public.stock_items
        ON CONFLICT (packaging_option_id) DO NOTHING
      `);
      await client.query(
        `SELECT pg_catalog.setval(pg_get_serial_sequence('public.inventory_items', 'id'), COALESCE((SELECT MAX(id) FROM public.inventory_items), 1), true)`,
      );
    }
    if (await tableExists(client, "stock_item_events")) {
      console.log("• Limpando tabela antiga stock_item_events...");
      await client.query(`DROP TABLE IF EXISTS public.stock_item_events`);
    }
    if (await tableExists(client, "stock_items")) {
      await client.query(`DROP TABLE IF EXISTS public.stock_items`);
    }

    // 5) Migrar stock_adjustments.system (Opção A) -> stock_adjustments.kind
    if ((await tableExists(client, "stock_adjustments")) && (await columnExists(client, "stock_adjustments", "system"))) {
      console.log("• Migrando stock_adjustments.system → kind...");
      await client.query(`ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'manual'`);
      await client.query(`
        UPDATE public.stock_adjustments
        SET kind = CASE
          WHEN system = false THEN 'manual'
          WHEN reason ILIKE 'Exclusão%' THEN 'item_delete'
          WHEN reason ILIKE 'Saldo inicial%' THEN 'opening'
          ELSE 'balance_edit'
        END
      `);
      await client.query(`ALTER TABLE public.stock_adjustments DROP COLUMN IF EXISTS system`);
    }

    // 6) Migrar demo_data_state (Opção A) -> app_state
    if (await tableExists(client, "demo_data_state")) {
      console.log("• Migrando demo_data_state → app_state...");
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.app_state (
          id text PRIMARY KEY,
          legacy_demo_tagged_at timestamptz,
          demo_cleaned_at timestamptz,
          demo_cleaned_by_name text,
          demo_removed_batches integer NOT NULL DEFAULT 0,
          demo_removed_shipments integer NOT NULL DEFAULT 0
        )
      `);
      const { rows } = await client.query(`SELECT identified_at, cleaned_at, cleaned_by_name, cleaned_counts FROM public.demo_data_state LIMIT 1`);
      if (rows[0]) {
        const counts = rows[0].cleaned_counts ?? {};
        await client.query(
          `INSERT INTO public.app_state (id, legacy_demo_tagged_at, demo_cleaned_at, demo_cleaned_by_name, demo_removed_batches, demo_removed_shipments)
           VALUES ('lifecycle', $1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             demo_cleaned_at = COALESCE(public.app_state.demo_cleaned_at, EXCLUDED.demo_cleaned_at),
             demo_cleaned_by_name = COALESCE(public.app_state.demo_cleaned_by_name, EXCLUDED.demo_cleaned_by_name)`,
          [
            rows[0].identified_at,
            rows[0].cleaned_at,
            rows[0].cleaned_by_name,
            Number(counts.batches ?? 0) || 0,
            Number(counts.shipments ?? 0) || 0,
          ],
        );
      }
      await client.query(`DROP TABLE IF EXISTS public.demo_data_state`);
    }

    // 7) Migrar visual_identity (Opção A) -> site_branding
    if (await tableExists(client, "visual_identity")) {
      console.log("• Migrando visual_identity → site_branding...");
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.site_branding (
          id text PRIMARY KEY,
          original_png text NOT NULL,
          original_name text NOT NULL,
          width integer NOT NULL,
          height integer NOT NULL,
          version text NOT NULL,
          icon_16 text NOT NULL,
          icon_32 text NOT NULL,
          apple_180 text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          updated_by_name text NOT NULL
        )
      `);
      const { rows } = await client.query(`
        SELECT v.source_name, v.source_mime, v.source_base64, v.updated_at, COALESCE(u.name, 'Administrador') AS actor_name
        FROM public.visual_identity v
        LEFT JOIN public.users u ON u.id = v.updated_by_id
        LIMIT 1
      `);
      if (rows[0]?.source_base64) {
        try {
          const rawBuf = Buffer.from(rows[0].source_base64, "base64");
          const pngBuf = rows[0].source_mime === "image/png" ? rawBuf : await sharp(rawBuf).png().toBuffer();
          const meta = await sharp(pngBuf).metadata();
          if (meta.width && meta.height) {
            const makeIcon = (size) =>
              sharp(pngBuf)
                .resize({ width: size, height: size, fit: "contain", kernel: sharp.kernel.lanczos3, background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .keepIccProfile()
                .png({ compressionLevel: 9, palette: false })
                .toBuffer();
            const [i16, i32, i180] = await Promise.all([makeIcon(16), makeIcon(32), makeIcon(180)]);
            const version = createHash("sha256").update(pngBuf).digest("hex");
            await client.query(
              `INSERT INTO public.site_branding (id, original_png, original_name, width, height, version, icon_16, icon_32, apple_180, updated_at, updated_by_name)
               VALUES ('main', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
               ON CONFLICT (id) DO NOTHING`,
              [
                pngBuf.toString("base64"),
                rows[0].source_name || "logo.png",
                meta.width,
                meta.height,
                version,
                i16.toString("base64"),
                i32.toString("base64"),
                i180.toString("base64"),
                rows[0].updated_at ?? new Date(),
                rows[0].actor_name,
              ],
            );
          }
        } catch (err) {
          console.warn("  Aviso: não foi possível converter visual_identity legado:", err.message);
        }
      }
      await client.query(`DROP TABLE IF EXISTS public.visual_identity`);
    }

    // 8) Garantir unicidade segura de users / access_profiles antes do drizzle-kit push criar índices parciais
    if ((await tableExists(client, "users")) && !(await columnExists(client, "users", "deleted_at"))) {
      await client.query(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by_name text`);
    }
    if ((await tableExists(client, "access_profiles")) && !(await columnExists(client, "access_profiles", "deleted_at"))) {
      await client.query(`ALTER TABLE public.access_profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz, ADD COLUMN IF NOT EXISTS deleted_by_name text`);
    }

    // 9) Suporte a múltiplas gramaturas por batelada + opção configurável no Admin
    if ((await tableExists(client, "app_state")) && !(await columnExists(client, "app_state", "allow_multi_format_batch"))) {
      console.log("• Adicionando app_state.allow_multi_format_batch...");
      await client.query(`ALTER TABLE public.app_state ADD COLUMN IF NOT EXISTS allow_multi_format_batch boolean NOT NULL DEFAULT true`);
    }
    if ((await tableExists(client, "batches")) && !(await tableExists(client, "batch_products"))) {
      console.log("• Criando tabela batch_products...");
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.batch_products (
          id serial PRIMARY KEY,
          batch_id integer NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
          product_id integer NOT NULL REFERENCES public.products(id),
          brand text NOT NULL,
          format text NOT NULL
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS batch_products_batch_product_uq
        ON public.batch_products (batch_id, product_id)
      `);
    }

    // 10) Hierarquia Admin Master / Admin Normal e limites configuráveis
    if ((await tableExists(client, "app_state")) && !(await columnExists(client, "app_state", "admin_limits"))) {
      console.log("• Adicionando app_state.admin_limits...");
      await client.query(`ALTER TABLE public.app_state ADD COLUMN IF NOT EXISTS admin_limits jsonb`);
    }
    if (await tableExists(client, "users")) {
      const hasSoftDelete = await columnExists(client, "users", "deleted_at");
      const notDeleted = hasSoftDelete ? "deleted_at IS NULL AND " : "";
      const { rows: masters } = await client.query(
        `SELECT id FROM public.users WHERE ${notDeleted} role = 'admin_master' AND active = true LIMIT 1`,
      );
      if (masters.length === 0) {
        const masterEmail = (process.env.ADMIN_MASTER_EMAIL?.trim() || process.env.ADMIN_EMAIL?.trim() || "vinicius@tem.com.br").toLowerCase();
        const { rows: candidates } = await client.query(
          `SELECT id FROM public.users
           WHERE ${notDeleted} active = true AND (LOWER(email) = $1 OR role = 'admin')
           ORDER BY CASE WHEN LOWER(email) = $1 THEN 0 ELSE 1 END, id ASC
           LIMIT 1`,
          [masterEmail],
        );
        if (candidates[0]) {
          console.log(`• Promovendo administrador principal (id=${candidates[0].id}) para admin_master...`);
          await client.query(`UPDATE public.users SET role = 'admin_master', updated_at = now() WHERE id = $1`, [candidates[0].id]);
        }
      }
    }

    await client.query("COMMIT");
    console.log("✓ Pré-migração do Neon concluída com segurança. Execute agora: npx drizzle-kit push");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Erro na pré-migração:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
