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
  private readonly checkIntervalMs = 30000;

  private readonly endpoints = {
    websearch: import.meta.env.VITE_WEBSEARCH_API_URL
      ? `${import.meta.env.VITE_WEBSEARCH_API_URL}/health/live`
      : 'http://localhost:8001/health/live',
    ai_backend: import.meta.env.VITE_PYTHON_API_URL
      ? `${import.meta.env.VITE_PYTHON_API_URL}/health`
      : 'http://localhost:8000/health',
  };

  private status: HealthStatus = {
    status: 'healthy',
    services: {},
    lastCheck: Date.now(),
  };

  private intervalId?: ReturnType<typeof window.setInterval>;

  async checkService(name: string, url: string, timeout = 5000): Promise<ServiceHealth> {
    const startedAt = Date.now();

    try {
      const response = await resilientFetch(
        url,
        { method: 'GET' },
        {
          maxRetries: 1,
          timeoutMs: timeout,
          initialDelayMs: 250,
          maxDelayMs: 1000,
        },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return {
        available: true,
        latency: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        available: false,
        error: error instanceof Error ? error.message : `Unknown error while checking ${name}`,
      };
    }
  }

  async checkAllServices(): Promise<HealthStatus> {
    const services = {
      websearch: await this.checkService('websearch', this.endpoints.websearch),
      ai_backend: await this.checkService('ai_backend', this.endpoints.ai_backend),
    };

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
    this.intervalId = window.setInterval(() => {
      void this.checkAllServices();
    }, this.checkIntervalMs);
  }

  stopMonitoring() {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  getStatus(): HealthStatus {
    return this.status;
  }
}

export const healthCheck = new HealthCheckService();
