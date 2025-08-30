# Authentication & Provider Updates

## Fixed Issues

### 1. Authentication Redirect Flow ✅

**Problem**: When redirecting to platform after login, it wasn't redirecting back to Tweet Genie correctly, and users weren't being taken to dashboard.

**Solutions Implemented**:

#### Server-side Changes:
- **Fixed redirect URLs** in `middleware/auth.js` - corrected port from 3001 to 3002
- **Added GET callback route** in `routes/auth.js` to handle platform redirects
- **Updated environment variables** in `.env` to include `PLATFORM_URL` and `TWEET_GENIE_URL`

#### Client-side Changes:
- **Created dedicated AuthCallback component** (`pages/AuthCallback.jsx`) for handling auth redirects
- **Updated App.jsx routing** to include `/auth/callback` route
- **Enhanced AuthContext** with better redirect handling and URL cleanup
- **Fixed environment variables** in client `.env` to point to correct platform URL

#### Flow Overview:
1. User visits Tweet Genie → Redirected to platform login if not authenticated
2. Platform authenticates → Redirects to `http://localhost:5174/auth/callback?token=xxx`
3. AuthCallback component → Sets httpOnly cookie via backend API
4. User redirected → Dashboard or original destination

### 2. Replaced Claude/Anthropic with Perplexity ✅

**Changed Files**:

#### Backend:
- **`services/aiService.js`**: 
  - Replaced `generateWithAnthropic()` with `generateWithPerplexity()`
  - Updated API endpoint to `https://api.perplexity.ai/chat/completions`
  - Changed model to `llama-3.1-sonar-small-128k-online`
  - Updated validation method for Perplexity API

- **`middleware/validation.js`**: Updated valid providers from `'anthropic'` to `'perplexity'`

- **`routes/providers.js`**: Changed provider display name from "Anthropic Claude" to "Perplexity AI"

- **`.env.example`**: Replaced `ANTHROPIC_API_KEY` with `PERPLEXITY_API_KEY`

#### Frontend:
- **`pages/TweetComposer.jsx`**: Updated dropdown option from "Anthropic Claude" to "Perplexity AI"

#### Documentation:
- **Updated all README files** to replace Anthropic/Claude references with Perplexity
- **Updated AI provider lists** across documentation

## Environment Configuration

### Server `.env` (Tweet Genie):
```bash
# Platform Integration
PLATFORM_URL=http://localhost:3000
PLATFORM_API_KEY=your_platform_api_key_here
TWEET_GENIE_URL=http://localhost:5174

# AI Provider Configuration
OPENAI_API_KEY=your_openai_api_key
PERPLEXITY_API_KEY=your_perplexity_api_key
GOOGLE_AI_API_KEY=your_google_ai_api_key
```

### Client `.env` (Tweet Genie):
```bash
VITE_API_URL=http://localhost:3002
VITE_PLATFORM_URL=http://localhost:5173
```

## Testing the Auth Flow

1. **Visit Tweet Genie**: Go to http://localhost:5174/
2. **Should redirect to platform login**: http://localhost:5173/login?redirect=...
3. **After platform login**: Should redirect back to http://localhost:5174/auth/callback?token=...
4. **Final redirect**: Should land on http://localhost:5174/dashboard

## API Providers Now Available

1. **OpenAI** - GPT models
2. **Perplexity AI** - llama-3.1-sonar-small-128k-online (with web search capabilities)
3. **Google AI** - Gemini models

## Key Files Modified

### Authentication:
- `tweet-genie/server/middleware/auth.js` - Fixed redirect URLs
- `tweet-genie/server/routes/auth.js` - Added GET callback route
- `tweet-genie/client/src/contexts/AuthContext.jsx` - Enhanced redirect handling
- `tweet-genie/client/src/pages/AuthCallback.jsx` - New auth callback component
- `tweet-genie/client/src/App.jsx` - Added auth callback route

### AI Provider Changes:
- `tweet-genie/server/services/aiService.js` - Perplexity integration
- `tweet-genie/server/middleware/validation.js` - Updated valid providers
- `tweet-genie/server/routes/providers.js` - Updated provider names
- `tweet-genie/client/src/pages/TweetComposer.jsx` - Updated UI options

## Production Deployment Notes

- Update `PLATFORM_URL` to production platform URL
- Update `TWEET_GENIE_URL` to production Tweet Genie URL  
- Ensure CORS settings allow the production domains
- Set secure cookie flags for HTTPS in production
