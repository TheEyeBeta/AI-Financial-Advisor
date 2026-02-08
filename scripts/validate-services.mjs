const WEBSEARCH_URL = process.env.WEBSEARCH_URL ?? 'http://localhost:8001';
const AI_BACKEND_URL = process.env.AI_BACKEND_URL ?? 'http://localhost:8000';

async function resilientFetch(url, options = {}, config = {}) {
  const finalConfig = {
    maxRetries: 2,
    initialDelayMs: 200,
    maxDelayMs: 2000,
    timeoutMs: 1500,
    retryableStatuses: [408, 429, 500, 502, 503, 504],
    ...config,
  };

  let lastError;

  for (let attempt = 0; attempt < finalConfig.maxRetries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), finalConfig.timeoutMs);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok && finalConfig.retryableStatuses.includes(response.status)) {
        throw new Error(`Retryable HTTP ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error;
      if (attempt === finalConfig.maxRetries - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(finalConfig.initialDelayMs * 2 ** attempt, finalConfig.maxDelayMs)));
    }
  }

  throw new Error(`Request failed after ${finalConfig.maxRetries} attempts: ${lastError?.message ?? 'unknown error'}`);
}

async function validateE2E() {
  const tests = [
    {
      name: 'Websearch health endpoint returns 200',
      test: async () => {
        const res = await fetch(`${WEBSEARCH_URL}/health`);
        return res.status === 200;
      },
    },
    {
      name: 'Websearch readiness endpoint handles dependency state',
      test: async () => {
        const res = await fetch(`${WEBSEARCH_URL}/health/ready`);
        return [200, 503].includes(res.status);
      },
    },
    {
      name: 'AI backend health endpoint reachable',
      test: async () => {
        const res = await fetch(`${AI_BACKEND_URL}/health`);
        return res.status === 200;
      },
    },
    {
      name: 'Timeout handling triggers retry/failure behavior',
      test: async () => {
        try {
          await resilientFetch(`${WEBSEARCH_URL}/api/search?query=timeout+probe`, {}, { timeoutMs: 1, maxRetries: 1 });
          return false;
        } catch (error) {
          return String(error.message).includes('failed after');
        }
      },
    },
  ];

  let failures = 0;

  for (const { name, test } of tests) {
    try {
      const passed = await test();
      if (!passed) {
        failures += 1;
      }
      console.log(`${passed ? '✅' : '❌'} ${name}`);
    } catch (error) {
      failures += 1;
      console.log(`❌ ${name}: ${error.message}`);
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
}

await validateE2E();
