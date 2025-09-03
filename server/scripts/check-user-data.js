import { pool } from '../config/database.js';

async function checkUserData() {
  try {
    const userId = 'b3fc01dd-df5d-4e05-8c74-0ab438cc5641'; // Your user ID from the logs
    
    console.log('🔍 Checking database data for user:', userId);
    console.log('=' .repeat(60));
    
    // Check user's Twitter connection
    console.log('📱 TWITTER CONNECTION:');
    const { rows: twitterAuth } = await pool.query(
      'SELECT twitter_user_id, twitter_username, twitter_display_name, created_at, updated_at FROM twitter_auth WHERE user_id = $1',
      [userId]
    );
    
    if (twitterAuth.length > 0) {
      console.log('✅ Twitter Connected:', {
        username: twitterAuth[0].twitter_username,
        display_name: twitterAuth[0].twitter_display_name,
        user_id: twitterAuth[0].twitter_user_id,
        connected_since: twitterAuth[0].created_at
      });
    } else {
      console.log('❌ No Twitter connection found');
    }
    
    console.log('\\n📊 TWEETS IN DATABASE:');
    const { rows: tweets } = await pool.query(
      'SELECT id, tweet_id, content, source, status, impressions, likes, retweets, replies, created_at FROM tweets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId]
    );
    
    console.log(`Total tweets found: ${tweets.length}`);
    tweets.forEach((tweet, index) => {
      console.log(`${index + 1}. ${tweet.source} - ${tweet.status} - ${tweet.content?.substring(0, 50)}... (${tweet.likes} likes, ${tweet.retweets} retweets)`);
    });
    
    // Check platform vs external tweets
    const { rows: tweetStats } = await pool.query(
      `SELECT 
        source,
        COUNT(*) as count,
        SUM(impressions) as total_impressions,
        SUM(likes) as total_likes,
        SUM(retweets) as total_retweets
       FROM tweets 
       WHERE user_id = $1 
       GROUP BY source`,
      [userId]
    );
    
    console.log('\\n📈 TWEET BREAKDOWN BY SOURCE:');
    tweetStats.forEach(stat => {
      console.log(`${stat.source}: ${stat.count} tweets, ${stat.total_likes} likes, ${stat.total_retweets} retweets`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('Error checking user data:', error);
    process.exit(1);
  }
}

checkUserData();
