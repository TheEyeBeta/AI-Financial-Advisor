async function validateE2E() {
  const baseWebsearch = process.env.WEBSEARCH_BASE_URL || 'http://localhost:8001';
  const baseTradeEngine = process.env.TRADE_ENGINE_BASE_URL || 'http://localhost:7000';

  const tests: Array<{ name: string; test: () => Promise<boolean> }> = [
    {
      name: 'Health check returns 200',
      test: async () => {
        const response = await fetch(`${baseWebsearch}/health`);
        return response.status === 200;
      },
    },
    {
      name: 'Liveness check returns 200',
      test: async () => {
        const response = await fetch(`${baseWebsearch}/health/live`);
        return response.status === 200;
      },
    },
    {
      name: 'Readiness endpoint is reachable',
      test: async () => {
        const response = await fetch(`${baseWebsearch}/health/ready`);
        return [200, 503].includes(response.status);
      },
    },
    {
      name: 'Trade Engine health responds within timeout',
      test: async () => {
        const start = Date.now();
        const response = await fetch(`${baseTradeEngine}/health`);
        const duration = Date.now() - start;
        return response.ok && duration < 5000;
      },
    },
    {
      name: 'Timeout path returns quickly for unreachable endpoint',
      test: async () => {
        const start = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 100);
          await fetch(`${baseTradeEngine}/definitely-missing-endpoint`, {
            signal: controller.signal,
          });
          clearTimeout(timeout);
          return false;
        } catch {
          return Date.now() - start < 1500;
        }
      },
    },
  ];

  for (const { name, test } of tests) {
    try {
      const passed = await test();
      console.log(`${passed ? '✅' : '❌'} ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`❌ ${name}: ${message}`);
    }
  }
}

void validateE2E();
