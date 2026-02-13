# Strategy Builder Feature - Implementation Plan

## 🎯 Overview
A conversational strategy builder that helps users create personalized content strategies for Twitter based on their niche, goals, and analytics. The system will chat with users, generate custom prompts, and eventually automate content creation and scheduling.

## ✅ CURRENT STATUS: Phase 1 & 2 COMPLETE! (Feb 14, 2026)

**What's Live:**
- ✅ Conversational chat interface (7-step onboarding)
- ✅ Strategy data capture and storage
- ✅ AI-powered prompt generation (30+ prompts)
- ✅ Prompt library with search, filter, favorites
- ✅ Direct integration with Tweet Composer
- ✅ Beautiful gradient UI with animations
- ✅ Full backend API (10 endpoints)
- ✅ Database schema (4 tables)
- ✅ Navigation integration with "New" badge

**Credit Costs:**
- Chat: 0.5 credits per message
- Generate Prompts: 10 credits
- Generate Content: 2 credits (existing)

**Files:** 7 new, 4 modified, ~1,300 lines of code

---

## 📋 Feature Breakdown

### **What We're Building:**
1. **Interactive Chat Interface** - Conversational onboarding to understand user's niche
2. **Strategy Generation** - AI-powered strategy creation based on user input
3. **Smart Prompt Library** - Curated prompts tailored to their niche and goals
4. **Analytics Integration** - Use existing analytics data to suggest optimal posting times
5. **Auto-Pilot Mode** - Generate and schedule content automatically from prompts

---

## 🚀 Implementation Phases

### **PHASE 1: Foundation & Chat Interface** ✅ COMPLETE (Week 1-2)
**Goal:** Build the conversational interface and gather user niche data

#### Frontend Tasks:
- [x] Create new page: `/strategy-builder` 
- [x] Build chat UI component (messages, input, thinking states)
- [x] Add navigation item in sidebar (dashboard, compose, **strategy**, analytics, history)
- [x] Design strategy overview dashboard

#### Backend Tasks:
- [x] Create `strategyBuilder.js` route
- [x] Create `strategyService.js` for chat logic
- [x] Database schema:
  ```sql
  CREATE TABLE user_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id),
    team_id TEXT REFERENCES teams(id),
    niche TEXT,
    target_audience TEXT,
    content_goals TEXT[],
    posting_frequency TEXT,
    tone_style TEXT,
    topics TEXT[],
    status TEXT DEFAULT 'draft', -- draft, active, paused
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE strategy_chat_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES user_strategies(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'user' or 'assistant'
    message TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```

#### Conversation Flow: ✅ IMPLEMENTED
1. **Welcome** - "Let's build your Twitter content strategy! 🚀" ✅
2. **Niche Discovery** - "What's your niche or industry?" (e.g., SaaS, AI, fitness) ✅
3. **Target Audience** - "Who are you trying to reach?" ✅
4. **Content Goals** - "What do you want to achieve?" (growth, engagement, sales, authority) ✅
5. **Posting Frequency** - "How often do you want to post?" (daily, 3x/week, etc.) ✅
6. **Tone & Style** - "What's your preferred tone?" (professional, casual, humorous, educational) ✅
7. **Topics** - "What topics do you want to cover?" (suggest based on niche) ✅
8. **Confirmation** - Show summary and confirm ✅

#### API Endpoints: ✅ ALL IMPLEMENTED
```
POST   /api/strategy/chat               ✅ Send message, get AI response
GET    /api/strategy/current            ✅ Get user's active strategy
GET    /api/strategy/list               ✅ Get all user strategies
GET    /api/strategy/:id                ✅ Get strategy by ID
GET    /api/strategy/:id/prompts        ✅ Get prompts for strategy
POST   /api/strategy/:id/generate-prompts ✅ Generate prompts
POST   /api/strategy/prompts/:id/favorite ✅ Toggle favorite
PATCH  /api/strategy/:id                ✅ Update strategy
DELETE /api/strategy/:id                ✅ Delete strategy
```

---

### **PHASE 2: Strategy Generation & Prompts** ✅ COMPLETE (Week 3-4)
**Goal:** Generate custom strategies and prompt libraries

#### Features:
- [x] AI-powered strategy generator based on chat data
- [x] Generate 20-50 custom prompts per niche
- [x] Categorize prompts (educational, promotional, engagement, storytelling)
- [x] Prompt template system

#### Backend Tasks:
- [x] Implement strategy generation algorithm
- [x] Create prompt library database
  ```sql
  CREATE TABLE strategy_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES user_strategies(id) ON DELETE CASCADE,
    category TEXT NOT NULL, -- educational, promotional, engagement, etc.
    prompt_text TEXT NOT NULL,
    variables JSONB, -- replaceable variables like {topic}, {benefit}
    usage_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP,
    is_favorite BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ```
- [x] Prompt generation service using AI
- [x] Variable substitution system

#### Frontend Tasks:
- [x] Strategy overview page (show generated strategy)
- [x] Prompt library UI (grid/list view, categories, search)
- [x] Prompt preview and editing
- [x] Favorite/bookmark prompts
- [x] One-click "Generate Content" from prompt
- [x] Integration with TweetComposer (auto-load prompts)

#### API Endpoints: ✅ ALL IMPLEMENTED
```
POST   /api/strategy/:id/generate-prompts  ✅ Generate strategy and prompts
GET    /api/strategy/:id/prompts           ✅ Get all prompts for strategy
POST   /api/strategy/prompts/:id/favorite  ✅ Toggle favorite
```

**Note:** Custom prompt adding/editing will be in Phase 5

---

### **PHASE 3: Analytics Integration** (Week 5)
**Goal:** Use analytics data to optimize strategy

#### Features:
- [ ] Analyze user's best-performing tweets
- [ ] Identify optimal posting times
- [ ] Suggest content types that perform well
- [ ] Engagement pattern analysis

#### Backend Tasks:
- [ ] Create analytics aggregation service
- [ ] Calculate optimal posting times from historical data
  ```sql
  -- Query to find best posting times
  SELECT 
    EXTRACT(DOW FROM created_at) as day_of_week,
    EXTRACT(HOUR FROM created_at) as hour,
    AVG(engagement_rate) as avg_engagement,
    COUNT(*) as tweet_count
  FROM tweet_analytics
  WHERE user_id = $1
    AND created_at > NOW() - INTERVAL '90 days'
  GROUP BY day_of_week, hour
  ORDER BY avg_engagement DESC
  LIMIT 10;
  ```
- [ ] Content performance insights
- [ ] Topic/hashtag performance analysis

#### Frontend Tasks:
- [ ] Best times visualization (heatmap)
- [ ] Performance insights cards
- [ ] Suggested improvements based on data
- [ ] "Apply insights to strategy" button

#### API Endpoints:
```
GET    /api/strategy/:id/insights        - Get analytics insights
GET    /api/strategy/:id/optimal-times   - Get best posting times
GET    /api/strategy/:id/top-content     - Get best performing content
```

---

### **PHASE 4: Auto-Pilot Content Generation** (Week 6-7)
**Goal:** Automatically generate and schedule content

#### Features:
- [ ] Batch content generation from prompts
- [ ] Smart scheduling based on optimal times
- [ ] Queue system for scheduled content
- [ ] Review & approve workflow

#### Backend Tasks:
- [ ] Auto-generation service
- [ ] Scheduling integration with existing system
- [ ] Queue management
  ```sql
  CREATE TABLE strategy_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id UUID REFERENCES user_strategies(id) ON DELETE CASCADE,
    prompt_id UUID REFERENCES strategy_prompts(id),
    generated_content TEXT,
    scheduled_for TIMESTAMP,
    status TEXT DEFAULT 'pending', -- pending, approved, posted, failed
    approval_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    posted_at TIMESTAMP
  );
  ```

#### Frontend Tasks:
- [ ] Auto-pilot settings panel
- [ ] Content queue management UI
- [ ] Bulk approve/reject interface
- [ ] Calendar view with scheduled content
- [ ] Enable/disable auto-pilot toggle

#### Workflow:
1. User enables auto-pilot
2. System selects prompts based on rotation and performance
3. Generates content using AI
4. Schedules at optimal times
5. (Optional) Requires approval before posting
6. Automatically posts when scheduled

#### API Endpoints:
```
POST   /api/strategy/:id/autopilot/enable   - Enable auto-pilot
POST   /api/strategy/:id/autopilot/disable  - Disable auto-pilot
GET    /api/strategy/:id/queue              - Get content queue
POST   /api/strategy/:id/queue/generate     - Generate content for queue
PATCH  /api/strategy/queue/:id/approve      - Approve content
PATCH  /api/strategy/queue/:id/reject       - Reject content
DELETE /api/strategy/queue/:id              - Remove from queue
```

---

### **PHASE 5: Polish & Advanced Features** (Week 8)
**Goal:** Enhance UX and add advanced capabilities

#### Features:
- [ ] Strategy templates (pre-built strategies for common niches)
- [ ] A/B testing for prompts
- [ ] Performance tracking per prompt
- [ ] Seasonal/trending topics integration
- [ ] Multi-account support (team strategies)
- [ ] Export strategy as PDF
- [ ] Strategy sharing/marketplace

---

## 🎨 UI/UX Design

### Page Structure:
```
/strategy-builder
├── /onboarding        - Chat interface for strategy creation
├── /dashboard         - Strategy overview & insights
├── /prompts           - Prompt library
├── /queue             - Content queue management
└── /settings          - Auto-pilot configuration
```

### Navigation Addition:
```
Sidebar:
- Dashboard
- Compose
- Strategy Builder ⭐ NEW
- Analytics
- History
- Scheduling
- Settings
```

### Key Components:
1. **ChatInterface.jsx** - Conversational UI
2. **StrategyOverview.jsx** - Main dashboard
3. **PromptLibrary.jsx** - Grid of prompts
4. **PromptCard.jsx** - Individual prompt display
5. **ContentQueue.jsx** - Scheduled content list
6. **AutoPilotSettings.jsx** - Configuration panel
7. **InsightsPanel.jsx** - Analytics visualization

---

## 🔧 Technical Stack

### Frontend:
- React components
- State management (Context API or existing)
- UI: Tailwind CSS (matching existing design)
- Charts: Recharts or Chart.js (for analytics)

### Backend:
- Express.js routes
- Services layer for business logic
- PostgreSQL for data storage
- AI integration (existing aiService.js)

### AI Integration:
- Use existing `aiService.js`
- Enhance with strategy-specific prompts
- Add prompt engineering for better results

---

## 💾 Database Schema Summary

```sql
-- Core Tables
user_strategies          -- User's strategy config
strategy_chat_history    -- Conversation history
strategy_prompts         -- Generated prompts
strategy_queue           -- Content queue
strategy_templates       -- Pre-built templates (Phase 5)

-- Indexes
idx_strategies_user_id
idx_prompts_strategy_id
idx_queue_strategy_id_status
idx_queue_scheduled_for
```

---

## 🔐 Credits & Permissions

### Credit Usage:
- **Chat with AI**: 0.5 credits per message
- **Generate Strategy**: 5 credits
- **Generate Prompt Library**: 10 credits
- **Auto-generate Content**: 2 credits per tweet (existing)

### Team Support:
- Team admins can create team-wide strategies
- Team members can view and use shared strategies
- Track usage per team member

---

## 📊 Success Metrics

Track these to measure feature success:
- Strategy creation rate
- Prompts generated per user
- Auto-pilot adoption rate
- Content posted via strategy builder
- User engagement improvement (before/after using strategy)
- Time saved (user survey)

---

## 🚦 Getting Started - Next Steps

### Immediate Actions:
1. ✅ Review and approve this plan
2. Create feature branch: `git checkout -b feature/strategy-builder`
3. Start with Phase 1: Chat interface
4. Create database migrations
5. Build basic UI shell

### First Code Files to Create:
```
Backend:
- server/routes/strategyBuilder.js
- server/services/strategyService.js
- server/migrations/create_strategy_tables.sql

Frontend:
- client/src/pages/StrategyBuilder/
  ├── index.jsx
  ├── ChatInterface.jsx
  ├── StrategyOverview.jsx
  └── PromptLibrary.jsx
```

---

## 💡 Example User Flow

1. User clicks "Strategy Builder" in sidebar
2. Greeted with conversational interface
3. Answers 7-8 questions about their niche/goals
4. AI generates personalized strategy with 30 prompts
5. User browses prompt library, favorites some
6. Clicks "Generate" on a prompt → creates content
7. Enables auto-pilot with settings:
   - Post 3x per day at optimal times
   - Requires approval before posting
8. System generates content queue for next 7 days
9. User reviews queue, approves all
10. Content automatically posts at scheduled times
11. Analyzes performance, adjusts prompts based on results

---

## 🎉 Why This Will Work

1. **Solves Real Problem** - Users struggle with consistent content creation
2. **Leverages Existing Features** - Uses your AI generation and scheduling
3. **Low Friction** - Conversational UI makes it easy to start
4. **Data-Driven** - Uses analytics to improve results
5. **Scalable** - Can add templates, marketplace, etc.
6. **Revenue Potential** - Premium feature or higher credit usage

---

---

## 🎉 Current Status: Phase 1 & 2 COMPLETE!

### ✅ What's Working Now:
1. **Conversational Strategy Setup** - Beautiful chat interface with 7-step onboarding
2. **AI-Powered Prompt Generation** - Generate 30+ custom prompts based on niche
3. **Prompt Library** - Search, filter, favorite, and use prompts
4. **Strategy Dashboard** - Visual overview of your strategy
5. **Integration** - Prompts auto-load in Compose page
6. **Navigation** - "Strategy Builder" menu with "New" badge

### 📁 Files Created:
**Backend:**
- `server/migrations/20260214_create_strategy_tables.sql`
- `server/services/strategyService.js`
- `server/routes/strategyBuilder.js`

**Frontend:**
- `client/src/pages/StrategyBuilder/index.jsx`
- `client/src/pages/StrategyBuilder/ChatInterface.jsx`
- `client/src/pages/StrategyBuilder/StrategyOverview.jsx`
- `client/src/pages/StrategyBuilder/PromptLibrary.jsx`

**Modified:**
- `server/index.js` - Added strategy routes
- `client/src/App.jsx` - Added /strategy route
- `client/src/components/Layout.jsx` - Added navigation item
- `client/src/pages/TweetComposer.jsx` - Prompt integration

### 🚀 Ready to Use!
Phases 1 & 2 are live and functional. Users can now create strategies and generate content from AI-powered prompts.

### 📋 Next: Phase 3 (Analytics Integration) & Phase 4 (Auto-Pilot)
These phases will add optimal posting times and automated content generation. 🎯
