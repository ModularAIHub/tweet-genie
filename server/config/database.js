import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Unified database configuration - supports both connection string and individual params
const config = process.env.DATABASE_URL 
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || 'tweet_genie',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };

// Add connection pool settings
Object.assign(config, {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  query_timeout: 30000,
});

console.log('Tweet Genie Database config:', {
  type: process.env.DATABASE_URL ? 'connection_string' : 'individual_params',
  host: config.host || 'from_connection_string',
  port: config.port || 'from_connection_string',
  database: config.database || 'from_connection_string',
  ssl: !!config.ssl
});

export const pool = new Pool(config);

// Connection event handlers
pool.on('connect', () => {
  console.log('✅ Connected to Tweet Genie database');
});

pool.on('error', (err) => {
  console.error('❌ Tweet Genie database connection error:', err);
});

// Test connection on startup
pool.query('SELECT NOW()')
  .then(() => console.log('✅ Tweet Genie database connection test successful'))
  .catch(err => console.error('❌ Tweet Genie database connection test failed:', err));

export default pool;
