import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');
const MIGRATION_TABLE = 'tweet_genie_migration_history';
const INTRA_DAY_MIGRATION_PRIORITY = {
  // Required dependency order: downstream migrations reference these tables.
  '20260214_create_strategy_tables.sql': 0,
};

const toPositiveInt = (value, fallback) =>
  Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;

const MIGRATION_LOCK_TIMEOUT_MS = toPositiveInt(
  Number.parseInt(process.env.MIGRATION_LOCK_TIMEOUT_MS || '5000', 10),
  5000
);
const MIGRATION_STATEMENT_TIMEOUT_MS = toPositiveInt(
  Number.parseInt(process.env.MIGRATION_STATEMENT_TIMEOUT_MS || '180000', 10),
  180000
);
const MIGRATION_QUERY_TIMEOUT_MS = toPositiveInt(
  Number.parseInt(
    process.env.MIGRATION_QUERY_TIMEOUT_MS || String(MIGRATION_STATEMENT_TIMEOUT_MS + 15000),
    10
  ),
  MIGRATION_STATEMENT_TIMEOUT_MS + 15000
);

const migrationDbUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '';
const isSupabaseConnection = migrationDbUrl.includes('supabase.com');

const poolConfig = migrationDbUrl
  ? {
      connectionString: migrationDbUrl,
      ssl:
        process.env.NODE_ENV === 'production' || isSupabaseConnection
          ? { rejectUnauthorized: false }
          : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: Number.parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME || 'tweet_genie',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

Object.assign(poolConfig, {
  max: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
  statement_timeout: MIGRATION_STATEMENT_TIMEOUT_MS,
  query_timeout: MIGRATION_QUERY_TIMEOUT_MS,
});

const migrationPool = new Pool(poolConfig);

const ensureMigrationTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      filename TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const getSortedMigrationFiles = async () => {
  const entries = await fs.readdir(MIGRATIONS_DIR, { withFileTypes: true });

  const parseDatePrefix = (filename) => {
    const match = /^(\d{8})_/.exec(filename);
    return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
  };

  const intraDayPriority = (filename) =>
    Object.prototype.hasOwnProperty.call(INTRA_DAY_MIGRATION_PRIORITY, filename)
      ? INTRA_DAY_MIGRATION_PRIORITY[filename]
      : 100;

  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const dateA = parseDatePrefix(a);
      const dateB = parseDatePrefix(b);
      if (dateA !== dateB) return dateA - dateB;

      const priorityA = intraDayPriority(a);
      const priorityB = intraDayPriority(b);
      if (priorityA !== priorityB) return priorityA - priorityB;

      return a.localeCompare(b);
    });
};

const computeChecksum = (sql) => crypto.createHash('sha256').update(sql).digest('hex');

export async function runMigrations() {
  console.log('[Tweet Genie][Migrate] Starting migrations...');
  console.log(
    `[Tweet Genie][Migrate] Timeouts: lock=${MIGRATION_LOCK_TIMEOUT_MS}ms, statement=${MIGRATION_STATEMENT_TIMEOUT_MS}ms, query=${MIGRATION_QUERY_TIMEOUT_MS}ms`
  );
  if (process.env.MIGRATION_DATABASE_URL) {
    console.log('[Tweet Genie][Migrate] Using MIGRATION_DATABASE_URL override');
  }

  const files = await getSortedMigrationFiles();
  if (!files.length) {
    console.log(`[Tweet Genie][Migrate] No SQL files found in ${MIGRATIONS_DIR}`);
    return;
  }

  const client = await migrationPool.connect();

  try {
    await ensureMigrationTable(client);

    const { rows } = await client.query(
      `SELECT filename, checksum FROM ${MIGRATION_TABLE} ORDER BY filename ASC`
    );
    const executed = new Map(rows.map((row) => [row.filename, row.checksum]));

    let applied = 0;
    let skipped = 0;

    for (const filename of files) {
      const absolutePath = path.join(MIGRATIONS_DIR, filename);
      const sql = await fs.readFile(absolutePath, 'utf8');
      const trimmed = sql.trim();

      if (!trimmed) {
        console.warn(`[Tweet Genie][Migrate] Skipping empty migration: ${filename}`);
        skipped += 1;
        continue;
      }

      const checksum = computeChecksum(sql);
      const priorChecksum = executed.get(filename);

      if (priorChecksum) {
        if (priorChecksum !== checksum) {
          throw new Error(
            `Checksum mismatch for already executed migration "${filename}". ` +
              'Do not modify executed migration files; create a new migration instead.'
          );
        }
        console.log(`[Tweet Genie][Migrate] Already applied: ${filename}`);
        skipped += 1;
        continue;
      }

      console.log(`[Tweet Genie][Migrate] Applying: ${filename}`);
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL lock_timeout = '${MIGRATION_LOCK_TIMEOUT_MS}ms'`);
        await client.query(`SET LOCAL statement_timeout = '${MIGRATION_STATEMENT_TIMEOUT_MS}ms'`);
        await client.query({
          text: sql,
          query_timeout: MIGRATION_QUERY_TIMEOUT_MS,
        });
        await client.query(
          `INSERT INTO ${MIGRATION_TABLE} (filename, checksum) VALUES ($1, $2)`,
          [filename, checksum]
        );
        await client.query('COMMIT');
        applied += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration failed for "${filename}" (${error.code || 'UNKNOWN'}): ${error.message}`
        );
      }
    }

    console.log(
      `[Tweet Genie][Migrate] Complete. Applied: ${applied}, Skipped: ${skipped}, Total: ${files.length}`
    );
  } finally {
    client.release();
    await migrationPool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  runMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('[Tweet Genie][Migrate] Failed:', error.message);
      process.exit(1);
    });
}
