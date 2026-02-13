import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  try {
    console.log('🚀 Running Strategy Builder migration...');
    
    const migrationFile = join(__dirname, 'migrations', '20260214_create_strategy_tables.sql');
    const sql = readFileSync(migrationFile, 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    console.log('📊 Created tables:');
    console.log('   - user_strategies');
    console.log('   - strategy_chat_history');
    console.log('   - strategy_prompts');
    console.log('   - strategy_queue');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runMigration();
