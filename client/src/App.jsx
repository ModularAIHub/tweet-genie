import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AccountProvider } from './contexts/AccountContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';

// Lazy load pages for better performance
const Dashboard = lazy(() => import('./pages/Dashboard'));
const TweetComposer = lazy(() => import('./pages/TweetComposer'));
const BulkGeneration = lazy(() => import('./pages/BulkGeneration'));
const Scheduling = lazy(() => import('./pages/Scheduling'));
const History = lazy(() => import('./pages/History'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Settings = lazy(() => import('./pages/Settings'));
const AuthCallback = lazy(() => import('./pages/AuthCallback'));

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center min-h-96">
    <div className="text-center">
      <LoadingSpinner size="lg" />
      <p className="mt-4 text-gray-600">Loading...</p>
    </div>
  </div>
);

function App() {
  return (
    <AuthProvider>
      <AccountProvider>
        <div className="min-h-screen bg-gray-50">
          <Routes>
            {/* Auth callback from platform */}
            <Route path="/auth/callback" element={
              <Suspense fallback={<PageLoader />}>
                <AuthCallback />
              </Suspense>
            } />
            
            {/* Protected routes */}
            <Route 
              path="/*" 
              element={
                <ProtectedRoute>
                  <Layout>
                    <Suspense fallback={<PageLoader />}>
                      <Routes>
                        <Route path="/" element={<Navigate to="/dashboard" replace />} />
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/compose" element={<TweetComposer />} />
                        <Route path="/bulk-generation" element={<BulkGeneration />} />
                        <Route path="/scheduling" element={<Scheduling />} />
                        <Route path="/history" element={<History />} />
                        <Route path="/analytics" element={<Analytics />} />
                        <Route path="/settings" element={<Settings />} />
                      </Routes>
                    </Suspense>
                  </Layout>
            </ProtectedRoute>
            } 
          />
        </Routes>
      </div>
      </AccountProvider>
    </AuthProvider>
  );
}

export default App;
