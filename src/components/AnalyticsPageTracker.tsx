import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { analytics } from '@/services/analytics';

/**
 * Tracks SPA route changes as page views.
 * Mount once inside <BrowserRouter>.
 */
export function AnalyticsPageTracker() {
  const location = useLocation();

  useEffect(() => {
    // Derive a human-readable page name from the pathname
    const name = location.pathname === '/'
      ? 'Landing'
      : location.pathname
          .replace(/^\//, '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());

    analytics.page(name, { path: location.pathname });
  }, [location.pathname]);

  return null;
}
