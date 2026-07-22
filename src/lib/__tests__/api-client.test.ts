import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// api-client.ts must resolve its backend URL through the single fail-fast
// resolver in lib/env.ts — never through a locally hardcoded fallback. Mock
// that resolver so each test controls exactly what URL (or failure) it returns.
const mockGetPythonApiUrl = vi.fn();

vi.mock('@/lib/env', () => ({
  getPythonApiUrl: (...args: unknown[]) => mockGetPythonApiUrl(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

describe('apiClient base URL resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    mockGetPythonApiUrl.mockReset();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the URL returned by the single env resolver, not a hardcoded fallback', async () => {
    mockGetPythonApiUrl.mockReturnValue('https://staging-backend.example.com');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { apiClient } = await import('../api-client');
    await apiClient.get('/api/ping');

    expect(mockGetPythonApiUrl).toHaveBeenCalled();
    const [calledUrl] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toBe('https://staging-backend.example.com/api/ping');
    expect(calledUrl).not.toContain('railway.app');
  });

  it('propagates a missing-config failure instead of silently falling back to a real backend', async () => {
    // This mirrors getPythonApiUrl() throwing in production when
    // VITE_PYTHON_API_URL is unset/malformed — the old code used
    // `import.meta.env.VITE_API_URL || 'https://...railway.app'`, which
    // would have silently targeted a live production backend instead.
    mockGetPythonApiUrl.mockImplementation(() => {
      throw new Error('VITE_PYTHON_API_URL must be configured with a real backend URL in production.');
    });

    const { apiClient } = await import('../api-client');
    await expect(apiClient.get('/api/ping')).rejects.toThrow('VITE_PYTHON_API_URL must be configured');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('resolves a configured staging URL correctly', async () => {
    mockGetPythonApiUrl.mockReturnValue('https://lens-staging.up.railway.app');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { apiClient } = await import('../api-client');
    await apiClient.get('/api/health');

    const [calledUrl] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toBe('https://lens-staging.up.railway.app/api/health');
  });

  it('resolves a configured production URL correctly', async () => {
    mockGetPythonApiUrl.mockReturnValue('https://api.lens.example.com');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { apiClient } = await import('../api-client');
    await apiClient.get('/api/health');

    const [calledUrl] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toBe('https://api.lens.example.com/api/health');
  });

  it('an explicit per-request baseUrl override still takes priority over the resolver', async () => {
    mockGetPythonApiUrl.mockReturnValue('https://should-not-be-used.example.com');
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { apiClient } = await import('../api-client');
    await apiClient.get('/api/ping', { baseUrl: 'https://override.example.com' });

    const [calledUrl] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toBe('https://override.example.com/api/ping');
  });

  it('does not call the resolver at all for an already-absolute URL', async () => {
    mockGetPythonApiUrl.mockImplementation(() => {
      throw new Error('should not be called for an absolute path');
    });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const { apiClient } = await import('../api-client');
    await apiClient.get('https://external.example.com/api/thing');

    expect(mockGetPythonApiUrl).not.toHaveBeenCalled();
    const [calledUrl] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toBe('https://external.example.com/api/thing');
  });
});
