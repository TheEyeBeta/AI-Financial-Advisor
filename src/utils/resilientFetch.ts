export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  retryableStatuses?: number[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 8000,
  timeoutMs: 5000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
};

class RetryableError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'RetryableError';
  }
}

export async function resilientFetch(
  url: string,
  options: RequestInit = {},
  config: Partial<RetryConfig> = {},
): Promise<Response> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error = new Error('Unknown request error');

  for (let attempt = 0; attempt < finalConfig.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), finalConfig.timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      if (!response.ok && finalConfig.retryableStatuses?.includes(response.status)) {
        throw new RetryableError(`HTTP ${response.status}`, response.status);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === finalConfig.maxRetries - 1) {
        break;
      }

      if (!(error instanceof RetryableError) && (error as Error).name !== 'AbortError') {
        throw error;
      }

      const delay = Math.min(finalConfig.initialDelayMs * 2 ** attempt, finalConfig.maxDelayMs);
      const jitter = delay * (0.75 + Math.random() * 0.5);

      console.warn(
        `Request failed (attempt ${attempt + 1}/${finalConfig.maxRetries}); retrying in ${Math.round(jitter)}ms`,
        { url, error: lastError.message },
      );

      await sleep(jitter);
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  throw new Error(
    `Request failed after ${finalConfig.maxRetries} attempts: ${lastError.message}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
