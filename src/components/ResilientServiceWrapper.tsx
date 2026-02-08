import { ReactNode, useCallback, useEffect, useState } from 'react';

import { healthCheck } from '@/services/healthCheck';

type WrapperStatus = 'loading' | 'available' | 'degraded' | 'down';

interface Props {
  serviceName: string;
  children: ReactNode;
  fallback?: ReactNode;
  onServiceDown?: () => void;
}

export function ResilientServiceWrapper({
  serviceName,
  children,
  fallback,
  onServiceDown,
}: Props) {
  const [serviceStatus, setServiceStatus] = useState<WrapperStatus>('loading');
  const [retryCount, setRetryCount] = useState(0);

  const checkStatus = useCallback(async () => {
    const health = await healthCheck.checkAllServices();
    const service = health.services[serviceName];

    if (!service?.available) {
      setServiceStatus('down');
      onServiceDown?.();
      return;
    }

    if ((service.latency ?? 0) > 3000) {
      setServiceStatus('degraded');
      return;
    }

    setServiceStatus('available');
    setRetryCount(0);
  }, [onServiceDown, serviceName]);

  useEffect(() => {
    healthCheck.startMonitoring();
    void checkStatus();
    const interval = setInterval(() => {
      void checkStatus();
    }, 30000);

    return () => {
      clearInterval(interval);
      healthCheck.stopMonitoring();
    };
  }, [checkStatus]);

  if (serviceStatus === 'loading') {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">Connecting to {serviceName}...</p>
      </div>
    );
  }

  if (serviceStatus === 'down') {
    return fallback ?? (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
        <h3 className="text-sm font-medium text-yellow-800">Service temporarily unavailable</h3>
        <p className="mt-2 text-sm text-yellow-700">
          We&apos;re having trouble connecting to {serviceName}. Some advisor features may be limited.
        </p>
        <button
          type="button"
          className="mt-4 inline-flex items-center px-3 py-2 rounded-md text-sm text-yellow-800 bg-yellow-100 hover:bg-yellow-200"
          onClick={() => {
            setRetryCount((previous) => previous + 1);
            setServiceStatus('loading');
            void checkStatus();
          }}
        >
          Retry {retryCount > 0 ? `(${retryCount})` : ''}
        </button>
      </div>
    );
  }

  if (serviceStatus === 'degraded') {
    return (
      <div>
        <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4 text-blue-700 text-sm">
          Service is responding slowly. Results may be delayed.
        </div>
        {children}
      </div>
    );
  }

  return <>{children}</>;
}
