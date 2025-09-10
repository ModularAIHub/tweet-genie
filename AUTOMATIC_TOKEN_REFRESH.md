# Automatic Token Refresh Behavior 🔄

## Scenario: RefreshToken Present, AccessToken Missing

When a user visits the site and has a `refreshToken` but no `accessToken`, the system will **automatically get a new access token** without requiring login credentials again.

## Updated Authentication Flow

### Before Fix:
```
User visits site
├── No accessToken found
└── ❌ Immediate redirect to login (even with valid refreshToken)
```

### After Fix:
```
User visits site
├── No accessToken found
├── RefreshToken exists? 
│   ├── ✅ Yes → Attempt automatic refresh
│   │   ├── ✅ Success → Set new accessToken → Continue as authenticated
│   │   └── ❌ Failed → Redirect to login
│   └── ❌ No → Redirect to login
```

## Implementation Details

### Server Middleware (`auth.js`)

```javascript
if (!token) {
  // Check if we have a refresh token to get a new access token
  if (req.cookies?.refreshToken) {
    console.log('❌ No access token but refresh token found - attempting automatic refresh...');
    try {
      // Call platform refresh endpoint
      const refreshResponse = await axios.post(
        `${PLATFORM_URL}/api/auth/refresh`,
        {},
        { headers: { 'Cookie': `refreshToken=${req.cookies.refreshToken}` } }
      );
      
      // Extract new access token and set cookie
      const newToken = extractTokenFromResponse(refreshResponse);
      res.cookie('accessToken', newToken, cookieOptions);
      
      // Continue with authentication using new token
      token = newToken;
      
    } catch (refreshError) {
      // Refresh failed - redirect to login
      return redirectToLogin();
    }
  } else {
    // No tokens at all - redirect to login
    return redirectToLogin();
  }
}
```

## User Experience Scenarios

### 1. Fresh Login ✅
```
User → Platform Login → Gets accessToken + refreshToken → Visits Tweet Genie → Automatic login
```

### 2. AccessToken Expired (Normal) ✅
```
User → Tries action → AccessToken expired → Auto-refresh → Continue seamlessly
```

### 3. AccessToken Missing, RefreshToken Valid ✅ **[NEW]**
```
User → Visits site → No accessToken → Has refreshToken → Auto-refresh → Automatic login
```

### 4. Both Tokens Missing ❌
```
User → Visits site → No tokens → Redirect to platform login
```

### 5. RefreshToken Expired ❌
```
User → Visits site → RefreshToken invalid → Redirect to platform login
```

## When This Happens

This scenario occurs when:

- ✅ **Browser cleared only accessToken cookie** (but kept refreshToken)
- ✅ **AccessToken expired and was cleared** (but refreshToken still valid)
- ✅ **Manual cookie deletion** of only accessToken
- ✅ **Server restart** that cleared some cookies but not others
- ✅ **Different browser security settings** affecting cookie retention

## Benefits

### Seamless User Experience
- 🚀 **No unnecessary logins** when user has valid refresh token
- 🚀 **Automatic recovery** from partial cookie loss
- 🚀 **Faster authentication** - no redirect to platform needed

### Security Maintained
- 🔒 **RefreshToken validation** with platform before issuing new accessToken
- 🔒 **Same security model** - only extends existing valid sessions
- 🔒 **Proper fallback** to login when refresh fails

### Developer Experience
- 🛠️ **Consistent behavior** across all authentication scenarios
- 🛠️ **Better error handling** with automatic recovery
- 🛠️ **Detailed logging** for debugging authentication issues

## Testing the Behavior

### Test Case 1: Simulate Missing AccessToken
```javascript
// In browser dev tools
document.cookie = "accessToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
// Keep refreshToken intact
// Refresh page - should auto-login
```

### Test Case 2: Check Logs
```javascript
// Server logs should show:
// "❌ No access token but refresh token found - attempting automatic refresh..."
// "✅ New access token obtained from refresh token"
```

### Test Case 3: Verify Cookies
```javascript
// After automatic refresh, both cookies should be present:
console.log(document.cookie); // Should show both accessToken and refreshToken
```

## Edge Cases Handled

1. **Network failure during refresh** → Fallback to login
2. **Platform server down** → Graceful error handling
3. **Invalid refresh token format** → Clear cookies and redirect to login
4. **Platform refresh endpoint changes** → Error handling with fallback
5. **Multiple simultaneous requests** → Token refresh coordination (handled by existing interceptor)

## Compatibility

- ✅ **Backward compatible** - doesn't affect existing working flows
- ✅ **Progressive enhancement** - adds automatic recovery capability
- ✅ **Cross-browser** - works with all modern browsers
- ✅ **Production ready** - includes proper error handling and logging

## Summary

The system now provides **intelligent automatic token refresh** that:

1. 🎯 **Detects** missing accessToken with valid refreshToken
2. 🔄 **Automatically** obtains new accessToken from platform
3. 🚀 **Continues** user session without interruption
4. 🛡️ **Falls back** to login only when necessary

This creates a much smoother user experience while maintaining security! 🎉
