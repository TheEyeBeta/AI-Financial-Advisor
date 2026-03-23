import { getPythonApiUrl, getWebSearchApiUrl, shouldMonitorBackendHealth } from '@/lib/env';
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

  private get endpoints() {
    return {
      websearch: `${getWebSearchApiUrl()}/health/live`,
      ai_backend: `${getPythonApiUrl()}/health`,
    };
  }

  private status: HealthStatus = {
    status: 'healthy',
    services: {},
    lastCheck: Date.now(),
  };

  private intervalId?: ReturnType<typeof window.setInterval>;

  private createMonitoringDisabledStatus(): HealthStatus {
    return {
      status: 'healthy',
      services: {
        websearch: { available: true },
        ai_backend: { available: true },
      },
      lastCheck: Date.now(),
    };
  }

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
      // Silently handle connection errors - backend might not be running
      // This is expected in development when backend isn't started
      const errorMessage = error instanceof Error ? error.message : `Unknown error while checking ${name}`;
      
      // Only log if it's not a connection refused (expected when backend is down)
      if (!errorMessage.includes('ERR_CONNECTION_REFUSED') && !errorMessage.includes('Failed to fetch')) {
        console.warn(`Health check failed for ${name}:`, errorMessage);
      }
      
      return {
        available: false,
        error: errorMessage,
      };
    }
  }

  async checkAllServices(): Promise<HealthStatus> {
    if (!shouldMonitorBackendHealth()) {
      this.status = this.createMonitoringDisabledStatus();
      return this.status;
    }

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
    this.stopMonitoring();

    if (!shouldMonitorBackendHealth()) {
      this.status = this.createMonitoringDisabledStatus();
      return;
    }

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
