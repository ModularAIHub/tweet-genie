import { pool } from '../config/database.js';

async function checkAllTweets() {
  try {
    const userId = 'b3fc01dd-df5d-4e05-8c74-0ab438cc5641';
    
    console.log('🔍 Checking ALL tweets for user:', userId);
    console.log('=' .repeat(60));
    
    const { rows: allTweets } = await pool.query(
      `SELECT id, tweet_id, content, source, status, 
              impressions, likes, retweets, replies, 
              created_at, external_created_at,
              CASE 
                WHEN source = 'external' THEN external_created_at
                ELSE created_at
              END as display_created_at
       FROM tweets 
       WHERE user_id = $1 
       ORDER BY 
         CASE 
           WHEN source = 'external' THEN external_created_at
           ELSE created_at
         END DESC`,
      [userId]
    );
    
    console.log(`Total tweets found: ${allTweets.length}`);
    console.log('\\nDetailed breakdown:');
    
    allTweets.forEach((tweet, index) => {
      console.log(`${index + 1}. ID: ${tweet.id}`);
      console.log(`   Content: ${tweet.content?.substring(0, 80)}...`);
      console.log(`   Source: ${tweet.source || 'platform'}`);
      console.log(`   Status: ${tweet.status}`);
      console.log(`   Metrics: ${tweet.likes} likes, ${tweet.retweets} retweets`);
      console.log(`   Created: ${tweet.display_created_at}`);
      console.log('   ---');
    });
    
    // Check by status
    const { rows: statusBreakdown } = await pool.query(
      'SELECT status, COUNT(*) as count FROM tweets WHERE user_id = $1 GROUP BY status',
      [userId]
    );
    
    console.log('\\nStatus breakdown:');
    statusBreakdown.forEach(stat => {
      console.log(`${stat.status}: ${stat.count} tweets`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkAllTweets();
