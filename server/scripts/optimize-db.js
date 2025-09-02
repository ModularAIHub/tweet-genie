import pool from '../config/database.js';

async function optimizeDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting Tweet Genie database optimization...');
    
    // Analyze table statistics
    console.log('📊 Analyzing table statistics...');
    await client.query('ANALYZE twitter_auth');
    await client.query('ANALYZE tweets');
    await client.query('ANALYZE scheduled_tweets');
    await client.query('ANALYZE ai_generations');
    console.log('✅ Table statistics updated');

    // Add missing indexes if needed
    console.log('🔍 Checking and creating additional indexes...');
    
    // Performance indexes for tweets
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tweets_user_status_created 
      ON tweets(user_id, status, created_at DESC)
    `);
    
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tweets_posted_at 
      ON tweets(posted_at DESC) WHERE posted_at IS NOT NULL
    `);

    // Performance indexes for scheduled tweets
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scheduled_tweets_status_time 
      ON scheduled_tweets(status, scheduled_for) WHERE status = 'pending'
    `);

    // Performance indexes for AI generations
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_generations_user_status 
      ON ai_generations(user_id, status, created_at DESC)
    `);

    console.log('✅ Additional indexes created');

    // Vacuum and reindex for better performance
    console.log('🧹 Running VACUUM and REINDEX...');
    await client.query('VACUUM ANALYZE twitter_auth');
    await client.query('VACUUM ANALYZE tweets');
    await client.query('VACUUM ANALYZE scheduled_tweets');
    await client.query('VACUUM ANALYZE ai_generations');
    await client.query('REINDEX TABLE tweets');
    await client.query('REINDEX TABLE scheduled_tweets');
    console.log('✅ Database maintenance completed');

    // Check table sizes
    console.log('📏 Checking table sizes...');
    const sizes = await client.query(`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_tables 
      WHERE schemaname NOT IN ('information_schema', 'pg_catalog')
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `);

    console.log('Table sizes:');
    sizes.rows.forEach(row => {
      console.log(`  ${row.tablename}: ${row.size}`);
    });

    // Check for unused data that can be cleaned up
    console.log('🧹 Checking for cleanup opportunities...');
    
    const oldDrafts = await client.query(`
      SELECT COUNT(*) FROM tweets 
      WHERE status = 'draft' AND created_at < NOW() - INTERVAL '30 days'
    `);
    
    const failedGenerations = await client.query(`
      SELECT COUNT(*) FROM ai_generations 
      WHERE status = 'failed' AND created_at < NOW() - INTERVAL '7 days'
    `);

    if (parseInt(oldDrafts.rows[0].count) > 0) {
      console.log(`💡 Found ${oldDrafts.rows[0].count} old draft tweets that could be cleaned up`);
    }

    if (parseInt(failedGenerations.rows[0].count) > 0) {
      console.log(`💡 Found ${failedGenerations.rows[0].count} old failed generations that could be cleaned up`);
    }

    console.log('🎉 Tweet Genie database optimization completed!');

  } catch (error) {
    console.error('❌ Database optimization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (process.argv[1].endsWith('optimize-db.js')) {
  optimizeDatabase()
    .then(() => {
      console.log('✅ Tweet Genie optimization finished successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Tweet Genie optimization failed:', error);
      process.exit(1);
    });
}

export { optimizeDatabase };
