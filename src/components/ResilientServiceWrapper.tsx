import { ReactNode, useEffect, useState } from 'react';

import { healthCheck } from '@/services/healthCheck';

interface ResilientServiceWrapperProps {
  serviceName: 'websearch' | 'ai_backend';
  children: ReactNode;
  fallback?: ReactNode;
  onServiceDown?: () => void;
}

type ServiceViewState = 'loading' | 'available' | 'degraded' | 'down';

export function ResilientServiceWrapper({
  serviceName,
  children,
  fallback,
  onServiceDown,
}: ResilientServiceWrapperProps) {
  const [serviceStatus, setServiceStatus] = useState<ServiceViewState>('loading');
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const checkStatus = async () => {
      const health = await healthCheck.checkAllServices();
      const service = health.services[serviceName];

      if (!service?.available) {
        setServiceStatus('down');
        onServiceDown?.();
        return;
      }

      if (service.latency && service.latency > 3000) {
        setServiceStatus('degraded');
      } else {
        setServiceStatus('available');
        setRetryCount(0);
      }
    };

    void checkStatus();
    const interval = window.setInterval(() => {
      void checkStatus();
    }, 30000);

    return () => {
      window.clearInterval(interval);
    };
  }, [serviceName, onServiceDown, retryCount]);

  const handleRetry = () => {
    setRetryCount((previous) => previous + 1);
    setServiceStatus('loading');
  };

  if (serviceStatus === 'loading') {
    return <div className="p-4 text-sm text-muted-foreground">Connecting to service…</div>;
  }

  if (serviceStatus === 'down') {
    return (
      fallback || (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-yellow-900">
          <p className="text-sm font-semibold">Service temporarily unavailable</p>
          <p className="mt-1 text-xs">
            We cannot connect to {serviceName} right now. Please retry in a moment.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="mt-3 rounded bg-yellow-100 px-3 py-1.5 text-xs font-medium hover:bg-yellow-200"
          >
            Retry {retryCount > 0 ? `(${retryCount})` : ''}
          </button>
        </div>
      )
    );
  }

  if (serviceStatus === 'degraded') {
    return (
      <>
        <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
          Service is responding slower than expected. Some operations may be delayed.
        </div>
        {children}
      </>
    );
  }

  return <>{children}</>;
}
