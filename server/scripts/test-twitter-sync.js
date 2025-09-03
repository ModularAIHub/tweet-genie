import { pool } from '../config/database.js';
import { TwitterApi } from 'twitter-api-v2';

async function testTwitterSync() {
  try {
    const userId = 'b3fc01dd-df5d-4e05-8c74-0ab438cc5641';
    
    // Get Twitter auth data
    const { rows } = await pool.query(
      'SELECT * FROM twitter_auth WHERE user_id = $1',
      [userId]
    );
    
    if (rows.length === 0) {
      console.log('❌ No Twitter connection found');
      return;
    }
    
    const twitterAccount = rows[0];
    console.log('✅ Twitter account found:', {
      username: twitterAccount.twitter_username,
      user_id: twitterAccount.twitter_user_id
    });
    
    // Test Twitter API connection
    const twitterClient = new TwitterApi(twitterAccount.access_token);
    
    console.log('🔄 Testing Twitter API connection...');
    
    try {
      // Try to fetch user timeline
      console.log('📱 Fetching user timeline...');
      const userTweets = await twitterClient.v2.userTimeline(twitterAccount.twitter_user_id, {
        max_results: 10,
        'tweet.fields': [
          'public_metrics',
          'created_at',
          'lang',
          'author_id'
        ],
        exclude: ['retweets', 'replies']
      });
      
      console.log('✅ Timeline fetched successfully!');
      console.log(`📊 Found ${userTweets.data?.length || 0} tweets`);
      
      if (userTweets.data && userTweets.data.length > 0) {
        console.log('\\n📝 Recent tweets:');
        userTweets.data.slice(0, 3).forEach((tweet, index) => {
          console.log(`${index + 1}. ${tweet.text?.substring(0, 80)}...`);
          console.log(`   Created: ${tweet.created_at}`);
          console.log(`   Metrics: ${tweet.public_metrics?.like_count || 0} likes, ${tweet.public_metrics?.retweet_count || 0} retweets`);
          console.log('   ---');
        });
      } else {
        console.log('ℹ️ No tweets found in timeline');
      }
      
    } catch (apiError) {
      if (apiError.code === 429) {
        console.log('❌ Rate limit still active');
        console.log(`Reset time: ${new Date(apiError.rateLimit?.reset * 1000)}`);
      } else {
        console.log('❌ Twitter API error:', apiError.message);
        console.log('Error code:', apiError.code);
      }
    }
    
    await pool.end();
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

testTwitterSync();
