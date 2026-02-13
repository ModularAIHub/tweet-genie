import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const DB_DEBUG = process.env.DB_DEBUG === 'true';
const DB_ERROR_LOG_THROTTLE_MS = Number.parseInt(process.env.DB_ERROR_LOG_THROTTLE_MS || '30000', 10);

let hasLoggedConnect = false;
let lastDbErrorAt = 0;

const dbDebug = (...args) => {
  if (DB_DEBUG) {
    console.log(...args);
  }
};

const dbError = (...args) => {
  const now = Date.now();
  if (now - lastDbErrorAt < DB_ERROR_LOG_THROTTLE_MS) {
    return;
  }
  lastDbErrorAt = now;
  console.error(...args);
};

const config = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME || 'tweet_genie',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

Object.assign(config, {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
});

dbDebug('Tweet Genie Database config:', {
  type: process.env.DATABASE_URL ? 'connection_string' : 'individual_params',
  host: config.host || 'from_connection_string',
  port: config.port || 'from_connection_string',
  database: config.database || 'from_connection_string',
  ssl: !!config.ssl,
});

export const pool = new Pool(config);

pool.on('connect', () => {
  if (hasLoggedConnect) return;
  hasLoggedConnect = true;
  dbDebug('Connected to Tweet Genie database');
});

pool.on('error', (err) => {
  dbError('Tweet Genie database connection error:', err?.message || err);
});

pool
  .query('SELECT NOW()')
  .then(() => dbDebug('Tweet Genie database connection test successful'))
  .catch((err) => dbError('Tweet Genie database connection test failed:', err?.message || err));

export default pool;

