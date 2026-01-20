// Test cookie setup in tweet-genie
import { pool } from './config/database.js';

async function testCookieAuth() {
    try {
        console.log('\n🍪 Testing Cookie Authentication\n');
        
        console.log('Environment variables:');
        console.log('  COOKIE_DOMAIN:', process.env.COOKIE_DOMAIN);
        console.log('  CLIENT_URL:', process.env.CLIENT_URL);
        console.log('  NODE_ENV:', process.env.NODE_ENV);
        console.log('  JWT_SECRET:', process.env.JWT_SECRET ? 'SET' : 'NOT SET');
        
        console.log('\n📋 Cookie Configuration:');
        console.log('In development with COOKIE_DOMAIN=localhost:');
        console.log('  ✅ Cookies work on same origin (http://localhost:3002 to http://localhost:3002)');
        console.log('  ❌ Cookies DON\'T work cross-origin (http://localhost:5174 to http://localhost:3002)');
        console.log('  ❌ Cookies DON\'T work cross-port even with localhost domain');
        
        console.log('\n💡 Solution for development:');
        console.log('  Option 1: Don\'t set COOKIE_DOMAIN at all (undefined)');
        console.log('  Option 2: Set sameSite=\'lax\' instead of \'none\' for development');
        console.log('  Option 3: Use Authorization header with localStorage instead');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

testCookieAuth();
