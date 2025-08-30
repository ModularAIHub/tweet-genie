# Tweet Genie Authentication Flow

## Overview
Tweet Genie now uses cookie-based authentication with seamless integration to the main platform. Users authenticate through the platform and are automatically redirected back to Tweet Genie with proper authentication.

## Authentication Flow

### 1. Initial Access
- User visits Tweet Genie (any protected route)
- If no authentication cookie is present, user is redirected to platform login
- Redirect URL includes current Tweet Genie URL for seamless return

### 2. Platform Authentication
- User logs in through the main platform
- Platform handles authentication and generates JWT token
- After successful login, platform redirects back to Tweet Genie with token

### 3. Token Exchange
- Tweet Genie receives token via URL parameter
- Frontend sends token to `/api/auth/callback` endpoint
- Backend sets httpOnly cookie and clears URL parameters
- User is redirected to original destination or dashboard

### 4. Subsequent Requests
- All API requests include httpOnly cookie automatically
- No localStorage or manual token management required
- Cookies are secure, httpOnly, and sameSite protected

## Configuration Updates

### Database Connection
- Updated to support URL-based configuration (Railway PostgreSQL)
- Falls back to individual parameters for local development
- Uses `DATABASE_URL` environment variable for production

### Redis Connection
- Updated to support Upstash Redis REST API
- Uses `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
- Falls back to standard Redis for local development

### Environment Variables

#### Server (.env)
```bash
# Platform Integration
PLATFORM_URL=http://localhost:3000
PLATFORM_API_KEY=your_platform_api_key
TWEET_GENIE_URL=http://localhost:3002

# Database (Production)
DATABASE_URL=postgresql://username:password@host:port/database

# Redis (Production - Upstash)
UPSTASH_REDIS_REST_URL=your_upstash_redis_rest_url
UPSTASH_REDIS_REST_TOKEN=your_upstash_redis_rest_token

# JWT Secret
JWT_SECRET=your_jwt_secret
```

#### Client (.env)
```bash
# API Configuration
VITE_API_URL=http://localhost:3002
VITE_PLATFORM_URL=http://localhost:3000
```

## Security Features

### httpOnly Cookies
- Prevents XSS attacks by making tokens inaccessible to JavaScript
- Automatically included in all requests to same domain
- Secure flag enabled in production

### CORS Configuration
- Credentials enabled for cookie support
- Proper origin validation
- Secure cross-origin requests

### Token Validation
- JWT tokens validated on every request
- User details fetched from platform for consistency
- Graceful fallback if platform is unavailable

## Middleware Updates

### Authentication Middleware
- Checks for token in cookies first
- Falls back to Authorization header for API compatibility
- Redirects web requests to platform for re-authentication
- Returns 401 for API requests when unauthenticated

### Error Handling
- Distinguishes between web and API requests
- Appropriate redirects vs JSON error responses
- Maintains user experience during auth failures

## Frontend Changes

### AuthContext
- Removed localStorage token management
- Added URL parameter token handling
- Centralized redirect logic
- Cookie-based authentication state

### API Configuration
- Removed Authorization header injection
- Added `withCredentials: true` for cookie support
- Updated error handling for redirects

### Protected Routes
- Simplified authentication checks
- Uses centralized redirect logic
- Better loading states

## Development vs Production

### Local Development
- Can use individual database/Redis parameters
- Platform runs on localhost:3000
- Tweet Genie runs on localhost:3002

### Production Deployment
- Uses URL-based database connection (Railway)
- Uses Upstash Redis REST API
- Secure cookie configuration
- HTTPS enforced for security

## Migration Notes

### From Token-based to Cookie-based
1. Remove any localStorage token management
2. Update API calls to use `withCredentials: true`
3. Configure CORS to allow credentials
4. Add cookie-parser middleware
5. Update authentication middleware for cookie support

### Database Migration
1. Update DATABASE_URL in environment
2. Ensure connection pooling is configured
3. Test connection with production credentials

### Redis Migration
1. Set up Upstash Redis instance
2. Configure REST API credentials
3. Update Redis client configuration
4. Test caching functionality

This authentication system provides a secure, seamless, and scalable solution for Tweet Genie while maintaining integration with the main platform ecosystem.
