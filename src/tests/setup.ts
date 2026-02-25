import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

// ─── Suppress noisy warnings that pollute test output ───────────────────
// React Router v7 migration warnings — we're on v6 and these are informational.
// They add ~30 lines of noise per test file that uses BrowserRouter.
const originalWarn = console.warn;
beforeAll(() => {
  console.warn = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('React Router Future Flag Warning')) return;
    originalWarn(...args);
  };
});

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// ─── Mock environment variables ─────────────────────────────────────────
process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.VITE_PYTHON_API_URL = 'http://localhost:8000';

// ─── Browser API mocks ─────────────────────────────────────────────────
// matchMedia — required by responsive/theme components
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// IntersectionObserver — required by lazy-loading / infinite scroll components
class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

// ResizeObserver — required by layout / chart components
class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});
