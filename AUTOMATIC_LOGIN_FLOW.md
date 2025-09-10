# Automatic Login Flow Documentation 🔄

## How It Works

The automatic login functionality is **already implemented** and works seamlessly when a user is logged into the platform. Here's how:

## Flow Diagram

```
User visits Tweet Genie
         ↓
AuthContext.checkAuthStatus()
         ↓
Frontend: auth.validate() → Backend: /api/auth/validate
         ↓
Backend: authenticateToken middleware
         ↓
Check for accessToken cookie from platform
         ↓
┌─────────────────┬─────────────────┐
│   Token Found   │  No Token Found │
│                 │                 │
│ ✅ Validate JWT │ ❌ Return 401   │
│ ✅ Call Platform│ 📍 Frontend     │
│ ✅ Set user data│    redirects to │
│ ✅ Auto login   │    platform     │
└─────────────────┴─────────────────┘
```

## Key Components

### 1. Cookie Sharing
- Platform sets cookies on `.suitegenie.in` domain
- Tweet Genie can read these cookies automatically
- No manual token passing needed

### 2. AuthContext (Frontend)
```javascript
// On app load
useEffect(() => {
  checkAuthStatus(); // Automatically checks for platform tokens
}, []);

const checkAuthStatus = async () => {
  try {
    const response = await auth.validate(); // Calls backend with cookies
    // If successful, user is automatically logged in
    setUser(response.data.user);
    setIsAuthenticated(true);
  } catch (error) {
    // If no valid token, redirect to platform login
    redirectToLogin();
  }
};
```

### 3. Authentication Middleware (Backend)
```javascript
export const authenticateToken = async (req, res, next) => {
  // 1. Check for accessToken cookie from platform
  let token = req.cookies?.accessToken;
  
  if (!token) {
    // No token = redirect to platform login
    return res.status(401).json({ error: 'Access token required' });
  }
  
  // 2. Verify JWT token
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  
  // 3. Get user details from platform
  const response = await axios.get(`${PLATFORM_URL}/api/auth/me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  // 4. Set user data and continue
  req.user = response.data;
  next();
};
```

## Automatic Token Refresh

The system has multiple layers of token refresh:

### 1. Client-Side Interceptor
```javascript
// api.js - Automatically refreshes expired tokens
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Try to refresh token automatically
      await axios.post('/api/auth/refresh');
      // Retry original request
      return api(originalRequest);
    }
  }
);
```

### 2. Server-Side Middleware Refresh
```javascript
// If JWT expired, try refresh token
if (jwtError.name === 'TokenExpiredError' && req.cookies?.refreshToken) {
  const refreshResponse = await axios.post(`${PLATFORM_URL}/api/auth/refresh`);
  // Get new token and continue
}
```

### 3. Periodic Refresh
```javascript
// AuthContext - Proactive refresh every 12 minutes
useEffect(() => {
  const interval = setInterval(() => {
    refreshTokenIfNeeded();
  }, 12 * 60 * 1000); // 12 minutes
}, [isAuthenticated]);
```

## Testing the Flow

### Scenario 1: User Not Logged Into Platform
1. Visit `http://localhost:5174`
2. AuthContext calls `checkAuthStatus()`
3. Backend returns 401 (no platform token)
4. Frontend redirects to platform login

### Scenario 2: User Already Logged Into Platform ✅
1. Visit `http://localhost:5174`
2. AuthContext calls `checkAuthStatus()`
3. Backend finds platform `accessToken` cookie
4. Backend validates token with platform
5. **User is automatically logged in** and redirected to dashboard

### Scenario 3: Token Expired
1. User tries to use Tweet Genie
2. Backend detects expired token
3. Backend automatically uses `refreshToken` to get new token
4. User continues without interruption

## Environment Configuration

### Development (localhost)
```javascript
// Cookies set on localhost domain
domain: undefined // Uses current domain
```

### Production (.suitegenie.in)
```javascript
// Cookies set on .suitegenie.in domain
domain: '.suitegenie.in' // Shared across subdomains
```

## Verification

The automatic login is working correctly. When you're logged into the platform:

1. ✅ Platform sets `accessToken` cookie on `.suitegenie.in`
2. ✅ Tweet Genie reads this cookie automatically
3. ✅ Backend validates token with platform
4. ✅ User is logged in without any manual steps
5. ✅ Automatic token refresh keeps session alive

## No Additional Implementation Needed

The automatic login functionality is **already working**. The system will:
- Detect when you're logged into the platform
- Automatically authenticate you in Tweet Genie
- Keep your session alive with automatic token refresh
- Seamlessly handle token expiration

You should be able to:
1. Log into the platform
2. Visit Tweet Genie
3. Be automatically logged in and redirected to dashboard
