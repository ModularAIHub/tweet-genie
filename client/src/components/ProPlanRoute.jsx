import React, { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { hasProPlanAccess } from '../utils/planAccess';

const ProPlanRoute = ({ children, featureName = 'This feature' }) => {
  const { user, isLoading } = useAuth();
  const warnedRef = useRef(false);
  const canAccess = hasProPlanAccess(user);

  useEffect(() => {
    if (isLoading || canAccess || warnedRef.current) return;
    warnedRef.current = true;
    toast.error(`${featureName} is available on Pro and above. Upgrade to continue.`);
  }, [canAccess, featureName, isLoading]);

  if (isLoading) {
    return null;
  }

  if (!canAccess) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default ProPlanRoute;
