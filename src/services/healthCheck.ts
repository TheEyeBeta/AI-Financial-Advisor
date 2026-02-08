import { resilientFetch } from '@/utils/resilientFetch';

export interface ServiceHealth {
  available: boolean;
  latency?: number;
  error?: string;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  services: Record<string, ServiceHealth>;
  lastCheck: number;
}

class HealthCheckService {
  private readonly checkInterval = 30000;

  private status: HealthStatus = {
    status: 'healthy',
    services: {},
    lastCheck: Date.now(),
  };

  private intervalId?: ReturnType<typeof setInterval>;

  private readonly serviceEndpoints: Record<string, string> = {
    websearch: import.meta.env.VITE_WEBSEARCH_API_URL
      ? `${import.meta.env.VITE_WEBSEARCH_API_URL}/health`
      : 'http://localhost:8001/health',
    ai_backend: import.meta.env.VITE_PYTHON_API_URL
      ? `${import.meta.env.VITE_PYTHON_API_URL}/health`
      : 'http://localhost:8000/health',
  };

  async checkService(name: string, url: string, timeout = 5000): Promise<ServiceHealth> {
    const startTime = Date.now();

    try {
      const response = await resilientFetch(
        url,
        { method: 'GET' },
        { timeoutMs: timeout, maxRetries: 2, initialDelayMs: 300 },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        available: true,
        latency: Date.now() - startTime,
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async checkAllServices(): Promise<HealthStatus> {
    const checks = Object.entries(this.serviceEndpoints).map(async ([name, url]) => [
      name,
      await this.checkService(name, url),
    ] as const);

    const services = Object.fromEntries(await Promise.all(checks));
    const allHealthy = Object.values(services).every((service) => service.available);
    const someHealthy = Object.values(services).some((service) => service.available);

    this.status = {
      status: allHealthy ? 'healthy' : someHealthy ? 'degraded' : 'down',
      services,
      lastCheck: Date.now(),
    };

    return this.status;
  }

  startMonitoring() {
    void this.checkAllServices();
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(() => {
      void this.checkAllServices();
    }, this.checkInterval);
  }

  stopMonitoring() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  getStatus(): HealthStatus {
    return this.status;
  }
}

export const healthCheck = new HealthCheckService();
