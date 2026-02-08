export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  retryableStatuses: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  timeoutMs: 5000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

export class RetryableError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = 'RetryableError';
  }
}

export async function resilientFetch(
  url: string,
  options: RequestInit = {},
  config: Partial<RetryConfig> = {},
): Promise<Response> {
  const finalConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < finalConfig.maxRetries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), finalConfig.timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok && finalConfig.retryableStatuses.includes(response.status)) {
        throw new RetryableError(`HTTP ${response.status}`, response.status);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === finalConfig.maxRetries - 1) {
        break;
      }

      const isAbortError = lastError.name === 'AbortError';
      const isRetryableError = lastError instanceof RetryableError;

      if (!isAbortError && !isRetryableError) {
        throw lastError;
      }

      const delay = Math.min(finalConfig.initialDelayMs * 2 ** attempt, finalConfig.maxDelayMs);
      const jitter = delay * (0.75 + Math.random() * 0.5);
      await sleep(jitter);
    }
  }

  throw new Error(`Request failed after ${finalConfig.maxRetries} attempts: ${lastError?.message ?? 'Unknown error'}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
