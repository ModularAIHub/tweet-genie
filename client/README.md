# Tweet Genie Client

Modern React frontend for Tweet Genie - Twitter posting, scheduling, and analytics management.

## Features

- **Dashboard**: Overview of Twitter activity and analytics
- **Tweet Composer**: Create tweets, threads, and AI-generated content
- **Scheduling**: Schedule tweets for optimal posting times
- **Analytics**: Detailed performance metrics and insights
- **Settings**: Manage Twitter connections and AI providers
- **Responsive Design**: Works seamlessly on desktop and mobile
- **Real-time Updates**: Live analytics and posting status

## Tech Stack

- **React 18** - Modern React with hooks and concurrent features
- **Vite** - Fast build tool and development server
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first CSS framework
- **Recharts** - Data visualization and charts
- **Axios** - HTTP client for API communication
- **React Hot Toast** - Beautiful toast notifications
- **Lucide React** - Modern icon library

## Prerequisites

- Node.js 18+
- npm or yarn package manager
- Tweet Genie server running
- Access to central hub authentication

## Installation

1. **Navigate to client directory**
   ```bash
   cd tweet-genie/client
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   # Create .env file
   VITE_API_URL=http://localhost:3002
   VITE_HUB_URL=http://localhost:5173
   ```

## Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

The client will start on `http://localhost:5174`

## Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Layout.jsx      # Main application layout
│   ├── LoadingSpinner.jsx
│   └── ProtectedRoute.jsx
├── contexts/           # React contexts
│   └── AuthContext.jsx # Authentication state management
├── pages/              # Page components
│   ├── Dashboard.jsx   # Main dashboard
│   ├── TweetComposer.jsx # Tweet creation
│   ├── Scheduling.jsx  # Scheduled tweets
│   ├── Analytics.jsx   # Performance analytics
│   ├── Settings.jsx    # Account settings
│   └── TwitterCallback.jsx # OAuth callback
├── utils/              # Utility functions
│   └── api.js         # API client configuration
├── App.jsx            # Main app component
├── main.jsx           # Application entry point
└── index.css          # Global styles
```

## Features Overview

### Dashboard
- **Quick Stats**: Tweet counts, impressions, engagement metrics
- **Recent Tweets**: Latest posted content with performance data
- **Quick Actions**: Fast access to compose, schedule, and analytics
- **Credit Balance**: Real-time credit usage tracking
- **Twitter Status**: Connection status and account information

### Tweet Composer
- **Rich Text Editor**: Character counting and validation
- **Thread Support**: Create multi-tweet threads
- **AI Generation**: Generate content using multiple AI providers
- **Media Upload**: Support for images, GIFs, and videos
- **Scheduling**: Schedule tweets for future posting
- **Draft Management**: Save and edit drafts

### Scheduling
- **Calendar View**: Visual scheduling interface
- **Batch Operations**: Manage multiple scheduled tweets
- **Status Tracking**: Monitor pending, completed, and failed posts
- **Time Zone Support**: Schedule in different time zones
- **Quick Actions**: Edit, cancel, or reschedule tweets

### Analytics
- **Performance Metrics**: Impressions, likes, retweets, replies
- **Interactive Charts**: Line charts, bar charts, engagement trends
- **Time Range Filtering**: 7, 30, 90-day views
- **Top Tweets**: Best performing content identification
- **Hashtag Analytics**: Track hashtag performance
- **Data Export**: Export analytics data

### Settings
- **Twitter Connection**: OAuth account linking
- **AI Providers**: Configure OpenAI, Perplexity, Google API keys
- **Preferences**: Timezone, notifications, auto-sync settings
- **Account Management**: Profile and security settings

## Component Design

### Layout System
- **Responsive Sidebar**: Collapsible navigation with mobile support
- **Header Bar**: User menu, notifications, quick actions
- **Main Content**: Dynamic page content with breadcrumbs
- **Credit Display**: Persistent credit balance indicator

### UI Components
- **Buttons**: Primary, secondary, danger variants with loading states
- **Forms**: Consistent input styling with validation
- **Cards**: Content containers with shadows and borders
- **Badges**: Status indicators with color coding
- **Modals**: Overlay dialogs with backdrop blur

### Color Scheme
- **Primary**: Blue tones for actions and links
- **Twitter**: Official Twitter blue for brand elements
- **Success**: Green for positive actions and status
- **Warning**: Yellow for cautions and pending states
- **Error**: Red for errors and destructive actions
- **Gray Scale**: Text hierarchy and backgrounds

## API Integration

### Authentication Flow
1. Check for stored JWT token
2. Validate token with Tweet Genie server
3. Redirect to hub login if invalid
4. Handle OAuth callback from Twitter

### Error Handling
- **Network Errors**: Retry logic and offline detection
- **API Errors**: User-friendly error messages
- **Validation Errors**: Real-time form validation
- **Credit Errors**: Clear insufficient credit messaging

### State Management
- **Auth Context**: User authentication state
- **Local State**: Component-specific data
- **API Caching**: Reduce redundant requests
- **Optimistic Updates**: Immediate UI feedback

## Styling

### Tailwind CSS
- **Utility Classes**: Rapid development with utility-first approach
- **Custom Components**: Reusable component classes
- **Responsive Design**: Mobile-first responsive utilities
- **Dark Mode**: Ready for dark mode implementation

### Design System
- **Typography**: Consistent text sizing and weights
- **Spacing**: Standardized margins and padding
- **Shadows**: Layered shadow system for depth
- **Borders**: Consistent border radius and colors
- **Animations**: Smooth transitions and micro-interactions

## Performance

### Optimization
- **Code Splitting**: Dynamic imports for route-based splitting
- **Image Optimization**: Responsive images with proper formats
- **Bundle Analysis**: Monitor and optimize bundle size
- **Caching**: API response caching and static asset optimization

### Loading States
- **Skeleton Screens**: Content placeholders while loading
- **Progressive Loading**: Load critical content first
- **Error Boundaries**: Graceful error handling
- **Retry Mechanisms**: Automatic retry for failed requests

## Accessibility

### WCAG Compliance
- **Keyboard Navigation**: Full keyboard accessibility
- **Screen Reader Support**: Proper ARIA labels and descriptions
- **Color Contrast**: AA compliance for text and backgrounds
- **Focus Management**: Clear focus indicators and logical tab order

### Best Practices
- **Semantic HTML**: Proper element usage for meaning
- **Alt Text**: Descriptive image alternatives
- **Form Labels**: Clear form labeling and validation
- **Error Messages**: Accessible error communication

## Security

### Client-Side Security
- **JWT Handling**: Secure token storage and transmission
- **Input Sanitization**: Prevent XSS attacks
- **HTTPS Enforcement**: Secure communication only
- **Content Security Policy**: Restrict resource loading

### Privacy
- **Data Minimization**: Only collect necessary data
- **Secure Storage**: Encrypted local storage where needed
- **API Key Protection**: Never expose sensitive keys
- **User Consent**: Clear privacy and data usage policies

## Deployment

### Build Process
```bash
# Install dependencies
npm install

# Build for production
npm run build

# The dist/ folder contains the built application
```

### Environment Configuration
- **API URLs**: Configure backend endpoints
- **Feature Flags**: Enable/disable features per environment
- **Analytics**: Set up tracking and monitoring
- **Error Reporting**: Configure error reporting services

### Hosting Options
- **Static Hosting**: Vercel, Netlify, GitHub Pages
- **CDN**: CloudFlare, AWS CloudFront
- **Docker**: Containerized deployment
- **Traditional Hosting**: Apache, Nginx

## Testing

### Testing Strategy
- **Unit Tests**: Component and utility function testing
- **Integration Tests**: API integration and user flows
- **E2E Tests**: Complete user journey testing
- **Accessibility Tests**: Automated accessibility checking

### Tools
- **Jest**: Unit testing framework
- **React Testing Library**: Component testing utilities
- **Cypress**: End-to-end testing
- **axe-core**: Accessibility testing

## Browser Support

- **Modern Browsers**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Mobile Browsers**: iOS Safari 14+, Chrome Mobile 90+
- **Progressive Enhancement**: Graceful degradation for older browsers

## Contributing

### Development Workflow
1. Fork the repository
2. Create a feature branch
3. Make changes with proper testing
4. Submit a pull request with description

### Code Standards
- **ESLint**: Code linting and formatting
- **Prettier**: Code formatting
- **TypeScript**: Type safety (if migrating)
- **Git Hooks**: Pre-commit code validation

## Troubleshooting

### Common Issues

1. **Build Failures**
   - Clear node_modules and reinstall
   - Check Node.js version compatibility
   - Verify environment variables

2. **API Connection Issues**
   - Verify API URL in environment
   - Check CORS configuration
   - Monitor network requests in dev tools

3. **Authentication Problems**
   - Clear browser local storage
   - Check JWT token validity
   - Verify hub integration settings

4. **Performance Issues**
   - Analyze bundle size
   - Check for memory leaks
   - Monitor API response times

### Development Tools
- **React DevTools**: Component debugging
- **Redux DevTools**: State management debugging
- **Network Tab**: API request monitoring
- **Lighthouse**: Performance auditing

## Support

For technical support:
1. Check browser console for errors
2. Verify API connectivity and responses
3. Test authentication flow
4. Monitor network requests and responses
5. Check environment configuration
