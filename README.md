# Tweet Genie

**AI-Powered Twitter Management Platform**

Tweet Genie is a comprehensive Twitter management solution that enables users to create, schedule, and analyze their Twitter content with the power of artificial intelligence. Built as part of the Autoverse ecosystem, it seamlessly integrates with the central hub for authentication and credit management.

## 🚀 Features

### 🐦 Twitter Management
- **Account Connection**: Secure OAuth integration with Twitter
- **Tweet Posting**: Create and post tweets with media support
- **Thread Creation**: Multi-tweet thread composition and posting
- **Real-time Analytics**: Track impressions, likes, retweets, and replies

### 🤖 AI Content Generation
- **Multiple Providers**: Support for OpenAI, Perplexity, and Google AI
- **Flexible Options**: Hub providers or bring-your-own-key (BYOK)
- **Content Styles**: Professional, casual, witty, and inspirational tones
- **Smart Suggestions**: AI-powered content optimization

### ⏰ Advanced Scheduling
- **Future Posting**: Schedule tweets for optimal engagement times
- **Timezone Support**: Multi-timezone scheduling capabilities
- **Batch Management**: Manage multiple scheduled tweets
- **Automated Posting**: Reliable background tweet posting

### 📊 Comprehensive Analytics
- **Performance Metrics**: Detailed engagement and reach analytics
- **Interactive Charts**: Visual representation of Twitter performance
- **Hashtag Analysis**: Track hashtag effectiveness
- **Export Capabilities**: Data export for external analysis

### 💳 Integrated Credit System
- **Transparent Pricing**: Clear credit costs for all operations
- **Real-time Balance**: Live credit balance monitoring
- **Automatic Refunds**: Credits refunded on failed operations
- **Usage History**: Detailed credit usage tracking

## 🏗️ Architecture

Tweet Genie follows a modern microservices architecture:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Client  │    │  Express Server │    │  Central Hub    │
│                 │    │                 │    │                 │
│ • Dashboard     │◄──►│ • API Routes    │◄──►│ • Authentication│
│ • Composer      │    │ • Services      │    │ • Credit System │
│ • Analytics     │    │ • Workers       │    │ • User Management│
│ • Settings      │    │ • Database      │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Twitter API   │    │   PostgreSQL    │    │     Redis       │
│                 │    │                 │    │                 │
│ • OAuth         │    │ • Tweet Storage │    │ • Sessions      │
│ • Posting       │    │ • Analytics     │    │ • Caching       │
│ • Analytics     │    │ • Scheduling    │    │ • Queue Jobs    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🛠️ Technology Stack

### Frontend
- **React 18** - Modern UI framework with hooks
- **Vite** - Fast build tool and dev server
- **Tailwind CSS** - Utility-first styling
- **React Router** - Client-side routing
- **Recharts** - Data visualization
- **Axios** - HTTP client

### Backend
- **Node.js** - JavaScript runtime
- **Express** - Web application framework
- **PostgreSQL** - Primary database
- **Redis** - Caching and sessions
- **JWT** - Authentication tokens
- **Joi** - Input validation

### External Services
- **Twitter API v2** - Twitter integration
- **OpenAI API** - AI content generation
- **Perplexity API** - Perplexity AI integration
- **Google AI** - Gemini integration

## 📦 Installation

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Redis 6+
- Twitter Developer Account
- Central Hub running (for authentication)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd tweet-genie
   ```

2. **Install dependencies**
   ```bash
   npm run install:all
   ```

3. **Set up environment variables**
   ```bash
   # Server configuration
   cp server/.env.example server/.env
   
   # Client configuration (optional)
   echo "VITE_API_URL=http://localhost:3002" > client/.env
   echo "VITE_HUB_URL=http://localhost:5173" >> client/.env
   ```

4. **Configure the database**
   ```bash
   # Update server/.env with your database credentials
   # Then run migrations
   cd server && npm run db:migrate
   ```

5. **Start the application**
   ```bash
   # Development mode (both server and client)
   npm run dev
   
   # Or start individually
   npm run server:dev  # Server on :3002
   npm run client:dev  # Client on :5174
   ```

### Production Deployment

```bash
# Build client
npm run build

# Start production server
npm start
```

## ⚙️ Configuration

### Environment Variables

#### Server (.env)
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

# Central Hub
HUB_API_URL=http://localhost:3001
HUB_API_KEY=your_hub_api_key

# Security
JWT_SECRET=your_jwt_secret
```

#### Client (.env)
```env
VITE_API_URL=http://localhost:3002
VITE_HUB_URL=http://localhost:5173
```

## 🔐 Security

### Authentication Flow
1. User authenticates with central hub
2. Hub issues JWT token for Tweet Genie
3. Token validated on each API request
4. Twitter OAuth handled securely server-side

### Data Protection
- Encrypted API key storage
- Secure JWT token handling
- Input validation and sanitization
- Rate limiting and abuse prevention

## 💰 Credit System

### Operation Costs
- **Tweet Post**: 1 credit
- **Tweet with Media**: 2 credits
- **AI Generation**: 2 credits per tweet
- **Thread Post**: 1 credit per tweet
- **Scheduling**: Free
- **Analytics**: Free

### Credit Flow
1. Check available credits before operation
2. Deduct credits upon successful completion
3. Refund credits if operation fails
4. Track all transactions for transparency

## 📊 API Documentation

### Authentication
```http
GET /api/auth/validate
Authorization: Bearer <jwt_token>
```

### Twitter Management
```http
# Get auth URL
GET /api/twitter/auth-url

# Connect account
POST /api/twitter/connect
{
  "oauth_token": "string",
  "oauth_token_secret": "string", 
  "oauth_verifier": "string"
}

# Post tweet
POST /api/tweets
{
  "content": "Hello, world!",
  "media": ["base64_image"],
  "thread": [{"content": "Tweet 2"}]
}
```

### AI Generation
```http
POST /api/tweets/ai-generate
{
  "prompt": "Share productivity tips",
  "provider": "openai",
  "style": "professional",
  "max_tweets": 3
}
```

### Analytics
```http
# Get overview
GET /api/analytics/overview?days=30

# Sync latest data
POST /api/analytics/sync
```

## 🔄 Background Jobs

### Scheduled Tweet Processing
- **Frequency**: Every minute
- **Function**: Check and post scheduled tweets
- **Failure Handling**: Retry mechanism with credit refunds

### Analytics Sync
- **Frequency**: Configurable (default: daily)
- **Function**: Update tweet metrics from Twitter API
- **Scope**: Recent tweets (last 7 days)

## 📈 Monitoring

### Health Checks
```http
GET /health
```

### Logging
- Request/response logging
- Error tracking with stack traces
- Performance metrics
- Credit transaction logs

## 🧪 Testing

### Backend Testing
```bash
cd server
npm test
```

### Frontend Testing
```bash
cd client
npm test
```

### E2E Testing
```bash
npm run test:e2e
```

## 🚀 Deployment Options

### Docker
```bash
# Build and run with Docker Compose
docker-compose up -d
```

### Manual Deployment
1. Set up production database and Redis
2. Configure environment variables
3. Run database migrations
4. Build client application
5. Start production server

### Cloud Deployment
- **Vercel/Netlify**: Frontend hosting
- **Railway/Heroku**: Backend hosting
- **AWS/GCP**: Full infrastructure
- **DigitalOcean**: VPS deployment

## 🤝 Integration with Autoverse Hub

Tweet Genie is designed to work seamlessly with the Autoverse platform:

### Shared Services
- **Authentication**: Single sign-on via hub
- **Credit Management**: Centralized credit system
- **User Management**: Unified user profiles
- **Billing**: Integrated subscription management

### Cross-Platform Features
- **Unified Dashboard**: Access from main hub
- **Credit Sharing**: Credits work across all apps
- **Single Account**: One account for all services

## 🛣️ Roadmap

### Phase 1 (Current)
- ✅ Basic Twitter posting
- ✅ AI content generation
- ✅ Tweet scheduling
- ✅ Analytics dashboard

### Phase 2 (Next)
- 🔄 Advanced analytics
- 🔄 Bulk operations
- 🔄 Content templates
- 🔄 Team collaboration

### Phase 3 (Future)
- 📅 Multi-platform support
- 📅 Advanced AI features
- 📅 Automation workflows
- 📅 Enterprise features

## 🐛 Troubleshooting

### Common Issues

#### Database Connection
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test connection
psql -h localhost -U your_user -d tweet_genie
```

#### Twitter API Issues
- Verify API credentials in .env
- Check Twitter developer portal for rate limits
- Ensure callback URLs are correctly configured

#### Credit System Problems
- Verify hub API URL and key
- Check network connectivity to hub
- Monitor credit balance in hub dashboard

## 📝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Follow ESLint configuration
- Write tests for new features
- Update documentation
- Follow semantic versioning

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Twitter API for social media integration
- OpenAI, Perplexity, and Google for AI capabilities
- React and Node.js communities
- Autoverse platform team

## 📞 Support

For support and questions:
- 📧 Email: support@autoverse.com
- 💬 Discord: [Autoverse Community](https://discord.gg/autoverse)
- 📖 Documentation: [docs.autoverse.com](https://docs.autoverse.com)
- 🐛 Issues: [GitHub Issues](https://github.com/autoverse/tweet-genie/issues)

---

**Tweet Genie** - Making Twitter management effortless with AI-powered automation.
