import React from 'react'
import ReactDOM from 'react-dom/client'
import { Honeybadger, HoneybadgerErrorBoundary } from '@honeybadger-io/react';
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import App from './App.jsx'
import ScrollToTop from './components/ScrollToTop.jsx'
import './index.css'

const isLocalhost = (() => {
  if (typeof window === 'undefined') return false;
  const host = String(window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
})();

const isDev = Boolean(import.meta.env.DEV);

const honeybadger = Honeybadger.configure({
  apiKey: 'hbp_A8vjKimYh8OnyV8J3djwKrpqc4OniI3a4MJg', // Replace with your real key
  environment: isDev || isLocalhost ? 'development' : 'production',
  beforeNotify: (notice) => {
    // Never page production alerts for local development errors.
    if (isLocalhost) {
      return false;
    }

    const message =
      String(notice?.error?.message || notice?.message || '').toLowerCase();

    // Ignore transient Fast Refresh hook-order errors in dev-like contexts.
    if (isDev && message.includes('rendered more hooks than during the previous render')) {
      return false;
    }

    return notice;
  },
});

if (isDev && typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const message = String(event?.error?.message || event?.message || '');
    if (!message.includes('Rendered more hooks than during the previous render')) {
      return;
    }

    const recoveryKey = 'suitegenie:hooks-mismatch-auto-reload';
    if (sessionStorage.getItem(recoveryKey) === '1') {
      return;
    }

    sessionStorage.setItem(recoveryKey, '1');
    window.location.reload();
  });
}

const appTree = (
  <HoneybadgerErrorBoundary honeybadger={honeybadger}>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ScrollToTop />
      <App />
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#363636',
            color: '#fff',
          },
          success: {
            style: {
              background: '#10b981',
            },
          },
          error: {
            style: {
              background: '#ef4444',
            },
          },
        }}
      />
    </BrowserRouter>
  </HoneybadgerErrorBoundary>
);

ReactDOM.createRoot(document.getElementById('root')).render(
  import.meta.env.DEV ? appTree : <React.StrictMode>{appTree}</React.StrictMode>
);
