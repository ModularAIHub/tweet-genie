import pool from './config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  try {
    const migrationFile = path.join(__dirname, 'migrations', '20260202_scheduled_tweets_approval.sql');
    const sql = fs.readFileSync(migrationFile, 'utf8');
    
    console.log('🔄 Running migration: 20260202_scheduled_tweets_approval.sql');
    await pool.query(sql);
    console.log('✅ Migration completed successfully!');
    
    // Verify the columns exist
    const { rows } = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'scheduled_tweets' 
      AND column_name IN ('team_id', 'approval_status', 'approved_by', 'approval_requested_at', 'rejection_reason')
      ORDER BY column_name
    `);
    
    console.log('\n✅ Verified columns in scheduled_tweets table:');
    rows.forEach(row => {
      console.log(`  - ${row.column_name} (${row.data_type})`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
