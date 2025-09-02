import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') });

async function cleanupSchema() {
  const client = await pool.connect();
  
  try {
    console.log('🧹 Cleaning up Tweet Genie database schema...');

    console.log('Dropping twitter_account_id column from tweets...');
    await client.query('ALTER TABLE tweets DROP COLUMN IF EXISTS twitter_account_id');
    console.log('✅ Dropped twitter_account_id column');

    console.log('Updating credits_used columns to NUMERIC...');
    await client.query('ALTER TABLE tweets ALTER COLUMN credits_used TYPE NUMERIC(10,2)');
    await client.query('ALTER TABLE ai_generations ALTER COLUMN credits_used TYPE NUMERIC(10,2)');
    console.log('✅ Updated credits_used columns to NUMERIC(10,2)');

    console.log('Dropping twitter_accounts table...');
    await client.query('DROP TABLE IF EXISTS twitter_accounts CASCADE');
    console.log('✅ Dropped twitter_accounts table');

    console.log('Recording migration...');
    try {
      await client.query(
        'INSERT INTO migration_history (version, name) VALUES ($1, $2)',
        [6, 'drop_twitter_accounts_table']
      );
      console.log('✅ Migration recorded');
    } catch (error) {
      if (error.message.includes('duplicate key')) {
        console.log('⚠️  Migration already recorded');
      } else {
        throw error;
      }
    }

    console.log('🎉 Schema cleanup completed successfully!');
    
  } catch (error) {
    console.error('❌ Schema cleanup failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanupSchema().catch(console.error);
