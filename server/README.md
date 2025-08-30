# Tweet Genie Server

Tweet Genie backend server providing Twitter posting, scheduling, and analytics capabilities.

## Features

- **Twitter Integration**: Connect and manage Twitter accounts via OAuth
- **Tweet Management**: Post tweets, threads, and media content
- **AI Content Generation**: Generate tweets using OpenAI, Perplexity, or Google AI
- **Scheduling**: Schedule tweets for future posting
- **Analytics**: Track tweet performance and engagement metrics
- **Credit System**: Integration with central hub credit management
- **Media Upload**: Support for images, GIFs, and video content

## Prerequisites

- Node.js 18+ 
- PostgreSQL database
- Redis server
- Twitter Developer Account with API keys
- AI Provider API keys (optional - for BYOK users)

## Installation

1. **Clone and navigate to the server directory**
   ```bash
   cd tweet-genie/server
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your configuration:
   ```env
   # Database
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=tweet_genie
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   
   # Redis
   REDIS_HOST=localhost
   REDIS_PORT=6379
   
   # Twitter API
   TWITTER_API_KEY=your_twitter_api_key
   TWITTER_API_SECRET=your_twitter_api_secret
   TWITTER_BEARER_TOKEN=your_twitter_bearer_token
   
   # Central Hub Integration
   HUB_API_URL=http://localhost:3001
   HUB_API_KEY=your_hub_api_key
   
   # JWT
   JWT_SECRET=your_jwt_secret
   ```

4. **Set up the database**
   ```bash
   # Run migrations
   npm run db:migrate
   
   # Seed initial data (optional)
   npm run db:seed
   ```

## Development

```bash
# Start development server
npm run dev

# Start production server
npm start
```

The server will start on `http://localhost:3002`

## API Endpoints

### Authentication
- `GET /api/auth/validate` - Validate JWT token

### Twitter
- `GET /api/twitter/auth-url` - Get Twitter OAuth URL
- `POST /api/twitter/connect` - Connect Twitter account
- `GET /api/twitter/accounts` - Get connected accounts
- `DELETE /api/twitter/disconnect/:id` - Disconnect account

### Tweets
- `POST /api/tweets` - Create and post tweet
- `GET /api/tweets` - Get user's tweets
- `DELETE /api/tweets/:id` - Delete tweet
- `POST /api/tweets/ai-generate` - Generate AI content

### Scheduling
- `POST /api/scheduling` - Schedule a tweet
- `GET /api/scheduling` - Get scheduled tweets
- `PUT /api/scheduling/:id` - Update scheduled tweet
- `DELETE /api/scheduling/:id` - Cancel scheduled tweet

### Analytics
- `GET /api/analytics/overview` - Get analytics overview
- `POST /api/analytics/detailed` - Get detailed analytics
- `POST /api/analytics/sync` - Sync latest metrics from Twitter
- `GET /api/analytics/hashtags` - Get hashtag performance

### Credits
- `GET /api/credits/balance` - Get credit balance
- `GET /api/credits/history` - Get usage history
- `GET /api/credits/pricing` - Get pricing information

### AI Providers
- `GET /api/providers` - Get AI providers status
- `POST /api/providers/:provider` - Configure provider API key
- `DELETE /api/providers/:provider` - Remove provider
- `POST /api/providers/:provider/test` - Test provider

## Database Schema

### Tables
- `twitter_accounts` - Connected Twitter accounts
- `tweets` - Tweet records and analytics
- `scheduled_tweets` - Scheduled tweet queue
- `ai_generations` - AI content generation history
- `user_ai_providers` - User's AI provider API keys
- `migration_history` - Database migration tracking

## Architecture

### Services
- `creditService` - Credit management and hub integration
- `aiService` - AI content generation with multiple providers
- `mediaService` - Media upload and processing
- `scheduledTweetService` - Background tweet posting

### Middleware
- `auth` - JWT authentication and Twitter account validation
- `errorHandler` - Centralized error handling
- `validation` - Request validation with Joi schemas

### Workers
- Cron job for processing scheduled tweets (runs every minute)
- Automatic expiration of old scheduled tweets

## Credit System Integration

Tweet Genie integrates with the central hub's credit system:

- **Tweet posting**: 1-2 credits (depending on media)
- **AI generation**: 2 credits per generated tweet
- **Thread posting**: 1 credit per tweet in thread
- **Scheduling**: Free
- **Analytics sync**: Free

Credits are checked before operations and refunded on failures.

## Error Handling

The server includes comprehensive error handling:

- Twitter API errors with specific error codes
- Credit insufficiency with required/available amounts
- Validation errors with detailed field information
- Database constraint violations
- Automatic error logging and user-friendly messages

## Security

- JWT token validation for all authenticated routes
- Encrypted storage of user API keys
- Rate limiting on API endpoints
- Input validation and sanitization
- Secure file upload handling

## Monitoring

- Health check endpoint: `GET /health`
- Detailed logging for all operations
- Error tracking and reporting
- Performance metrics collection

## Deployment

1. **Environment Setup**
   - Set production environment variables
   - Configure database and Redis connections
   - Set up Twitter API credentials
   - Configure hub integration

2. **Database Migration**
   ```bash
   npm run db:migrate
   ```

3. **Start Production Server**
   ```bash
   npm start
   ```

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify database credentials in `.env`
   - Ensure PostgreSQL is running
   - Check network connectivity

2. **Twitter API Errors**
   - Verify Twitter API credentials
   - Check API rate limits
   - Ensure proper OAuth callback URLs

3. **Credit System Issues**
   - Verify hub API URL and key
   - Check network connectivity to hub
   - Monitor credit balance and usage

4. **Scheduled Tweet Failures**
   - Check cron job is running
   - Verify Twitter account tokens are valid
   - Monitor error logs for specific failures

### Logs

Server logs include:
- Request/response information
- Database query execution
- Twitter API interactions
- Credit system transactions
- Error details and stack traces

## Support

For technical support:
1. Check server logs for error details
2. Verify configuration and credentials
3. Test individual components (database, Redis, Twitter API)
4. Monitor credit balance and usage patterns
