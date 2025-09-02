import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from './config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') });

async function testSchema() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Tweet Genie database schema...');

    // Test if twitter_accounts table was removed
    try {
      await client.query('SELECT 1 FROM twitter_accounts LIMIT 1');
      console.log('❌ twitter_accounts table still exists (should be removed)');
    } catch (error) {
      if (error.message.includes('does not exist')) {
        console.log('✅ twitter_accounts table successfully removed');
      } else {
        console.log('❓ Unexpected error checking twitter_accounts:', error.message);
      }
    }

    // Test if twitter_auth table exists
    const { rows: authRows } = await client.query(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_name = 'twitter_auth' 
       ORDER BY ordinal_position`
    );
    
    if (authRows.length > 0) {
      console.log('✅ twitter_auth table exists with columns:');
      authRows.forEach(row => {
        console.log(`   - ${row.column_name}: ${row.data_type}`);
      });
    } else {
      console.log('❌ twitter_auth table not found');
    }

    // Test if tweets table has correct structure (no twitter_account_id)
    const { rows: tweetCols } = await client.query(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_name = 'tweets' 
       ORDER BY ordinal_position`
    );
    
    const hasTwitterAccountId = tweetCols.some(col => col.column_name === 'twitter_account_id');
    const creditsColumn = tweetCols.find(col => col.column_name === 'credits_used');
    
    if (hasTwitterAccountId) {
      console.log('❌ tweets table still has twitter_account_id column (should be removed)');
    } else {
      console.log('✅ tweets table correctly removed twitter_account_id column');
    }

    if (creditsColumn) {
      console.log(`✅ tweets table credits_used column: ${creditsColumn.data_type}`);
      if (creditsColumn.data_type === 'numeric') {
        console.log('✅ credits_used uses NUMERIC type for fractional support');
      } else {
        console.log('❌ credits_used should use NUMERIC type');
      }
    }

    // Test migration history
    const { rows: migrations } = await client.query(
      'SELECT version, name FROM migration_history ORDER BY version'
    );
    
    console.log('\n📋 Migration history:');
    migrations.forEach(m => {
      console.log(`   v${m.version}: ${m.name}`);
    });

    console.log('\n🎉 Schema test completed!');
    
  } catch (error) {
    console.error('❌ Schema test failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

testSchema().catch(console.error);
