import { pool } from '../config/database.js';

async function addMissingColumns() {
  try {
    console.log('Adding missing columns to tweets table...');
    
    // Add source column
    await pool.query("ALTER TABLE tweets ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'platform';");
    console.log('✅ Added source column');
    
    // Add external_created_at column
    await pool.query('ALTER TABLE tweets ADD COLUMN IF NOT EXISTS external_created_at TIMESTAMP;');
    console.log('✅ Added external_created_at column');
    
    // Add quote_count column
    await pool.query('ALTER TABLE tweets ADD COLUMN IF NOT EXISTS quote_count INTEGER DEFAULT 0;');
    console.log('✅ Added quote_count column');
    
    // Add bookmark_count column
    await pool.query('ALTER TABLE tweets ADD COLUMN IF NOT EXISTS bookmark_count INTEGER DEFAULT 0;');
    console.log('✅ Added bookmark_count column');
    
    // Add author_id column
    await pool.query('ALTER TABLE tweets ADD COLUMN IF NOT EXISTS author_id VARCHAR(255);');
    console.log('✅ Added author_id column');
    
    // Add lang column
    await pool.query('ALTER TABLE tweets ADD COLUMN IF NOT EXISTS lang VARCHAR(10);');
    console.log('✅ Added lang column');
    
    // Update existing tweets to have platform source
    await pool.query("UPDATE tweets SET source = 'platform' WHERE source IS NULL;");
    console.log('✅ Updated existing tweets source');
    
    console.log('All columns added successfully!');
    await pool.end();
  } catch (error) {
    console.error('Error adding columns:', error);
    process.exit(1);
  }
}

addMissingColumns();
