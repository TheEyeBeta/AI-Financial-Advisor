import { supabase } from '@/lib/supabase';
import type { StockDetail } from '@/types/database';

const BASE_URL = import.meta.env.VITE_API_URL ||
  'https://ai-financial-advisor-backend-production.up.railway.app';

// ─── Error type ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Retry config ────────────────────────────────────────────────────────────

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: Set<number>;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 8000,
  retryableStatuses: new Set([500, 502, 503, 504]),
};

function backoffDelay(attempt: number, config: RetryConfig): number {
  const base = config.initialDelayMs * 2 ** attempt;
  const jitter = Math.random() * base * 0.3;
  return Math.min(base + jitter, config.maxDelayMs);
}

// ─── Core request function ───────────────────────────────────────────────────

async function getAuthToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Default per-request timeout in milliseconds (60 seconds). */
const DEFAULT_TIMEOUT_MS = 60_000;

interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Override the base URL (defaults to getPythonApiUrl()) */
  baseUrl?: string;
  /** Skip auth header injection */
  skipAuth?: boolean;
  /** Skip retry logic */
  skipRetry?: boolean;
  /** Request body — objects are JSON-stringified automatically */
  body?: RequestInit['body'] | Record<string, unknown>;
  /** Per-request timeout in milliseconds. Defaults to 30 000. Set to 0 to disable. */
  timeoutMs?: number;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    baseUrl,
    skipAuth = false,
    skipRetry = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    body,
    headers: extraHeaders,
    ...fetchOptions
  } = options;

  const base = baseUrl ?? BASE_URL;
  const url = path.startsWith('http') ? path : `${base}${path}`;

  // Build headers
  const headers = new Headers(extraHeaders);
  if (!headers.has('Content-Type') && body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob)) {
    headers.set('Content-Type', 'application/json');
  }

  if (!skipAuth) {
    const token = await getAuthToken();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const serializedBody =
    body && typeof body === 'object' && !(body instanceof FormData) && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && !(body instanceof ReadableStream)
      ? JSON.stringify(body)
      : body as RequestInit['body'];

  const config = DEFAULT_RETRY;
  const maxAttempts = skipRetry ? 1 : config.maxRetries + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug(`[api-client] ${fetchOptions.method ?? 'GET'} ${url}`, attempt > 0 ? `(retry ${attempt})` : '');
      }

      // Per-attempt timeout via AbortController
      const controller = timeoutMs > 0 ? new AbortController() : null;
      const timeoutId = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;

      let response: Response;
      try {
        response = await fetch(url, {
          ...fetchOptions,
          headers,
          body: serializedBody,
          signal: controller?.signal,
        });
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }

      if (!response.ok) {
        // Retry on 5xx
        if (!skipRetry && config.retryableStatuses.has(response.status) && attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, backoffDelay(attempt, config)));
          continue;
        }

        // Parse error body
        let errorBody: unknown;
        let errorMessage: string;
        try {
          errorBody = await response.json();
          errorMessage = (errorBody as { detail?: string; message?: string })?.detail
            ?? (errorBody as { message?: string })?.message
            ?? response.statusText;
        } catch {
          errorMessage = response.statusText;
        }

        throw new ApiError(response.status, errorMessage, errorBody);
      }

      // Handle empty responses (204, etc.)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return undefined as T;
      }

      const data: T = await response.json();

      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug(`[api-client] ${response.status} ${url}`);
      }

      return data;
    } catch (error) {
      // Don't retry ApiErrors (already handled above)
      if (error instanceof ApiError) throw error;

      // Retry network errors
      if (attempt < maxAttempts - 1 && !skipRetry) {
        await new Promise((r) => setTimeout(r, backoffDelay(attempt, config)));
        continue;
      }

      throw error;
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new Error('Request failed after all retries');
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'GET' });
  },

  post<T>(path: string, body?: Record<string, unknown> | RequestInit['body'], options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'POST', body });
  },

  put<T>(path: string, body?: Record<string, unknown> | RequestInit['body'], options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'PUT', body });
  },

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, { ...options, method: 'DELETE' });
  },
};

export function getStockDetail(ticker: string): Promise<StockDetail> {
  return apiClient.get<StockDetail>(`/api/stocks/detail/${encodeURIComponent(ticker)}`);
}
