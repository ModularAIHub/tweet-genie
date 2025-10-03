import dotenv from 'dotenv';
dotenv.config();

async function testTwitterCredentials() {
  console.log('🔍 Testing Twitter API credentials...');
  
  const clientId = process.env.TWITTER_CLIENT_ID;
  const clientSecret = process.env.TWITTER_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    console.error('❌ Missing Twitter credentials in environment');
    return;
  }
  
  console.log('✅ Client ID exists:', clientId.substring(0, 10) + '...');
  console.log('✅ Client Secret exists:', clientSecret.substring(0, 10) + '...');
  
  // Test the Basic Auth header format
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  console.log('🔑 Basic Auth header would be:', `Basic ${credentials.substring(0, 20)}...`);
  
  // Test a simple request to Twitter API (this should fail but give us more info)
  try {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_secret: clientSecret // Add client_secret as form parameter
      }),
    });
    
    const result = await response.json();
    console.log('📝 Twitter API test response:', result);
    
    if (response.ok) {
      console.log('✅ Twitter credentials are valid');
    } else {
      console.log('❌ Twitter API error:', result);
    }
  } catch (error) {
    console.error('❌ Network error:', error);
  }
}

testTwitterCredentials().catch(console.error);