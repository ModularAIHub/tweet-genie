import React, { createContext, useContext, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { logEvent } from 'firebase/analytics';
import { getToken, onMessage } from 'firebase/messaging';
import { fetchAndActivate, getValue } from 'firebase/remote-config';
import {
  getFirebaseAnalytics,
  getFirebaseMessaging,
  getFirebaseRemoteConfig
} from '../config/firebase';

const FirebaseContext = createContext(null);

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (!context) throw new Error('useFirebase must be used within FirebaseProvider');
  return context;
};

export const FirebaseProvider = ({ children }) => {
  const location = useLocation();
  const [analyticsInstance, setAnalyticsInstance] = useState(null);
  const [rcInstance, setRcInstance] = useState(null);
  const [fcmToken, setFcmToken] = useState(null);
  const [rcReady, setRcReady] = useState(false);

  // Init Analytics
  useEffect(() => {
    getFirebaseAnalytics().then(setAnalyticsInstance);
  }, []);

  // Init Remote Config
  useEffect(() => {
    const rc = getFirebaseRemoteConfig();
    if (!rc) return;
    setRcInstance(rc);
    fetchAndActivate(rc)
      .then(() => setRcReady(true))
      .catch((err) => {
        console.warn('Remote Config fetch failed, using defaults:', err);
        setRcReady(true);
      });
  }, []);

  // Track route changes
  useEffect(() => {
    if (!analyticsInstance) return;
    logEvent(analyticsInstance, 'page_view', {
      page_path: location.pathname,
      page_title: document.title,
      app: 'suitegenie'
    });
  }, [location, analyticsInstance]);

  // FCM — manual trigger only
  const requestFCMPermission = async () => {
    try {
      const msg = await getFirebaseMessaging();
      if (!msg) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const token = await getToken(msg, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY
      });

      if (token) {
        setFcmToken(token);
        await saveFcmToken(token);
      }

      onMessage(msg, (payload) => {
        console.log('FCM foreground message:', payload);
        // wire into your toast system here
      });

    } catch (err) {
      console.error('FCM setup failed:', err);
    }
  };

  const getFlag = (key) => {
    if (!rcInstance || !rcReady) return false;
    return getValue(rcInstance, key).asBoolean();
  };

  const getConfigValue = (key) => {
    if (!rcInstance || !rcReady) return '';
    return getValue(rcInstance, key).asString();
  };

  const logAnalyticsEvent = (eventName, params = {}) => {
    if (analyticsInstance) {
      logEvent(analyticsInstance, eventName, {
        ...params,
        app: 'suitegenie'
      });
    }
  };

  return (
    <FirebaseContext.Provider value={{
      logAnalyticsEvent,
      fcmToken,
      requestFCMPermission,
      getFlag,
      getConfigValue
    }}>
      {children}
    </FirebaseContext.Provider>
  );
};

async function saveFcmToken(token) {
  // await supabase.from('user_fcm_tokens').upsert({
  //   token,
  //   app: 'suitegenie',
  //   updated_at: new Date().toISOString()
  // })
}