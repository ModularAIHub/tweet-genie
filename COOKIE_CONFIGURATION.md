# Cookie Configuration for Tweet Genie

## Overview
This document explains how cookies are configured for different environments in the Tweet Genie application.

## Cookie Domains

### Development (localhost)
- **Domain**: No domain set (defaults to current host)
- **Behavior**: Cookies work on `localhost:3000`, `localhost:3002`, etc.
- **Security**: `secure: false`, `sameSite: 'lax'`

### Production (.suitegenie.in)
- **Domain**: `.suitegenie.in`
- **Behavior**: Cookies work across all subdomains (api.suitegenie.in, platform.suitegenie.in, etc.)
- **Security**: `secure: true`, `sameSite: 'none'`

## Cookie Types

### Access Token
- **Name**: `accessToken`
- **Duration**: 15 minutes
- **Type**: httpOnly cookie
- **Purpose**: Short-lived authentication token

### Refresh Token
- **Name**: `refreshToken`
- **Duration**: 7 days
- **Type**: httpOnly cookie
- **Purpose**: Long-lived token for refreshing access tokens

## Implementation

### Server-side (routes/auth.js)
Uses utility functions from `utils/cookieUtils.js`:
- `setAuthCookies(res, accessToken, refreshToken)` - Sets both tokens
- `clearAuthCookies(res)` - Clears both tokens (logout)

### Environment Detection
```javascript
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  cookieOptions.domain = '.suitegenie.in';
}
// For localhost, no domain is set
```

## Files Modified
- `server/routes/auth.js` - Main auth logic
- `server/utils/cookieUtils.js` - Cookie utility functions
- `server/.env` - Environment configuration
- `client/.env` - Client environment configuration

## Testing
- **Development**: Test on `localhost:3000` → `localhost:3002`
- **Production**: Test on `platform.suitegenie.in` → `api.suitegenie.in`

## Security Features
- httpOnly cookies (prevent XSS)
- Secure cookies in production (HTTPS only)
- SameSite protection
- Domain-specific cookies
- Automatic token refresh
