import React, { useRef, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * AnimatedPage wraps route content with a smooth fade+slide transition
 * on each route change, using the location key to detect navigation.
 */
const AnimatedPage = ({ children }) => {
  const location = useLocation();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [transitionState, setTransitionState] = useState('enter'); // 'enter' | 'exit'
  const prevKeyRef = useRef(location.key);

  useEffect(() => {
    if (location.key !== prevKeyRef.current) {
      // Route changed — trigger exit, then swap content and enter
      setTransitionState('exit');
      const timeout = setTimeout(() => {
        prevKeyRef.current = location.key;
        setDisplayChildren(children);
        setTransitionState('enter');
      }, 150); // short exit duration
      return () => clearTimeout(timeout);
    } else {
      // Same route, just update children (e.g. re-render)
      setDisplayChildren(children);
    }
  }, [children, location.key]);

  return (
    <div
      className={`h-full transition-all duration-200 ease-out ${
        transitionState === 'enter'
          ? 'opacity-100 translate-y-0'
          : 'opacity-0 translate-y-1'
      }`}
    >
      {displayChildren}
    </div>
  );
};

export default AnimatedPage;
