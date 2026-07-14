import { describe, it, expect } from 'vitest';
import type { ErrorEvent } from '@sentry/react';
import {
  REDACTED,
  PRODUCTION_BASELINE_TRACE_RATE,
  PRODUCTION_CRITICAL_TRACE_RATE,
  buildSentryOptions,
  getReleaseSha,
  redactBreadcrumb,
  redactSentryEvent,
  sampleTransaction,
  scrubText,
  scrubValue,
  stripUrlQuery,
} from '../telemetry';

const FAKE_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.sflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';

describe('stripUrlQuery', () => {
  it('removes query strings and fragments', () => {
    expect(stripUrlQuery('https://app.example.com/ws?token=abc#frag')).toBe(
      'https://app.example.com/ws'
    );
    expect(stripUrlQuery('/advisor?prompt=my+secret')).toBe('/advisor');
  });

  it('leaves clean URLs untouched', () => {
    expect(stripUrlQuery('https://app.example.com/advisor')).toBe('https://app.example.com/advisor');
  });
});

describe('scrubText', () => {
  it('redacts JWTs', () => {
    expect(scrubText(`failed with ${FAKE_JWT}`)).not.toContain(FAKE_JWT);
  });

  it('redacts bearer tokens', () => {
    expect(scrubText('Authorization: Bearer abc.def.ghi')).not.toMatch(/bearer abc/i);
  });

  it('redacts email addresses', () => {
    expect(scrubText('user jane.doe+test@example.co.uk failed')).not.toContain('@example.co.uk');
  });

  it('redacts provider API key shapes', () => {
    expect(scrubText('key sk-proj-abcdef1234567890')).not.toContain('sk-proj-abcdef1234567890');
  });
});

describe('scrubValue', () => {
  it('redacts values under sensitive keys', () => {
    const scrubbed = scrubValue({
      prompt: 'what should I buy?',
      portfolio: { AAPL: 10 },
      balance: 90210,
      email: 'a@b.com',
      access_token: 'abc',
      safe: 'keep-me',
    }) as Record<string, unknown>;

    expect(scrubbed.prompt).toBe(REDACTED);
    expect(scrubbed.portfolio).toBe(REDACTED);
    expect(scrubbed.balance).toBe(REDACTED);
    expect(scrubbed.email).toBe(REDACTED);
    expect(scrubbed.access_token).toBe(REDACTED);
    expect(scrubbed.safe).toBe('keep-me');
  });

  it('strips query strings from nested URL values', () => {
    const scrubbed = scrubValue({ nested: { url: 'https://x.test/a?token=1' } }) as {
      nested: { url: string };
    };
    expect(scrubbed.nested.url).toBe('https://x.test/a');
  });

  it('preserves Dates as ISO strings instead of collapsing them to {}', () => {
    const when = new Date('2026-07-13T12:00:00Z');
    expect(scrubValue({ when })).toEqual({ when: '2026-07-13T12:00:00.000Z' });
  });

  it('preserves Error name/message with pattern scrubbing applied', () => {
    const scrubbed = scrubValue({ err: new Error(`boom for jane@x.com`) }) as { err: string };
    expect(scrubbed.err).toContain('Error: boom');
    expect(scrubbed.err).not.toContain('jane@x.com');
  });

  it('stringifies other non-plain objects rather than emptying them', () => {
    const scrubbed = scrubValue({ m: new Map([['a', 1]]), s: new Set([1]) }) as {
      m: string;
      s: string;
    };
    expect(typeof scrubbed.m).toBe('string');
    expect(typeof scrubbed.s).toBe('string');
    expect(scrubbed.m).not.toEqual({});
  });
});

describe('redactBreadcrumb', () => {
  it('drops console breadcrumbs entirely', () => {
    expect(redactBreadcrumb({ category: 'console', message: 'secret log' })).toBeNull();
  });

  it('strips query strings from fetch breadcrumb URLs', () => {
    const crumb = redactBreadcrumb({
      category: 'fetch',
      data: { url: 'https://api.test/news?apikey=xyz', method: 'GET' },
    });
    expect(crumb?.data?.url).toBe('https://api.test/news');
  });

  it('scrubs tokens from breadcrumb messages', () => {
    const crumb = redactBreadcrumb({ category: 'ui.click', message: `clicked ${FAKE_JWT}` });
    expect(crumb?.message).not.toContain(FAKE_JWT);
  });
});

describe('redactSentryEvent', () => {
  it('reduces user to a pseudonymous id', () => {
    const event = redactSentryEvent({
      user: {
        id: 'uuid-1234',
        email: 'jane@example.com',
        ip_address: '10.0.0.1',
        username: 'jane',
      },
    } as ErrorEvent);
    expect(event.user).toEqual({ id: 'uuid-1234' });
  });

  it('drops the user entirely when there is no id', () => {
    const event = redactSentryEvent({ user: { email: 'jane@example.com' } } as ErrorEvent);
    expect(event.user).toBeUndefined();
  });

  it('drops request headers, cookies, body, and query string', () => {
    const event = redactSentryEvent({
      request: {
        url: 'https://app.test/advisor?session=abc',
        headers: { Authorization: `Bearer ${FAKE_JWT}`, Cookie: 'sb=1' },
        cookies: { sb: '1' },
        data: { prompt: 'secret' },
        query_string: 'session=abc',
      },
    } as ErrorEvent);
    expect(event.request?.headers).toBeUndefined();
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.data).toBeUndefined();
    expect(event.request?.query_string).toBeUndefined();
    expect(event.request?.url).toBe('https://app.test/advisor');
  });

  it('scrubs exception values and messages', () => {
    const event = redactSentryEvent({
      message: `boom ${FAKE_JWT}`,
      exception: { values: [{ type: 'Error', value: `token=${FAKE_JWT} for jane@x.com` }] },
    } as ErrorEvent);
    expect(event.message).not.toContain(FAKE_JWT);
    expect(event.exception?.values?.[0].value).not.toContain(FAKE_JWT);
    expect(event.exception?.values?.[0].value).not.toContain('jane@x.com');
  });

  it('scrubs extra and contexts payloads', () => {
    const event = redactSentryEvent({
      extra: { prompt: 'buy TSLA?', requestId: 'r-1' },
      contexts: { profile: { income: 100000 }, app: { app_version: '1.0' } },
    } as ErrorEvent);
    expect(event.extra?.prompt).toBe(REDACTED);
    expect(event.extra?.requestId).toBe('r-1');
    // "profile" is a sensitive key: the whole object is dropped.
    expect(event.contexts?.profile).toBe(REDACTED);
    expect((event.contexts?.app as Record<string, unknown>).app_version).toBe('1.0');
  });

  it('filters console breadcrumbs and strips breadcrumb URLs', () => {
    const event = redactSentryEvent({
      breadcrumbs: [
        { category: 'console', message: 'noisy' },
        { category: 'fetch', data: { url: 'https://api.test/x?token=1' } },
      ],
    } as ErrorEvent);
    expect(event.breadcrumbs).toHaveLength(1);
    expect(event.breadcrumbs?.[0].data?.url).toBe('https://api.test/x');
  });
});

describe('sampleTransaction', () => {
  it('samples everything outside production', () => {
    expect(sampleTransaction('development', '/advisor')).toBe(1.0);
    expect(sampleTransaction('test', '/anything')).toBe(1.0);
  });

  it('uses a low baseline in production', () => {
    expect(sampleTransaction('production', '/academy')).toBe(PRODUCTION_BASELINE_TRACE_RATE);
    expect(sampleTransaction('production', undefined)).toBe(PRODUCTION_BASELINE_TRACE_RATE);
  });

  it('samples critical routes at the elevated production rate', () => {
    expect(sampleTransaction('production', '/advisor')).toBe(PRODUCTION_CRITICAL_TRACE_RATE);
    expect(sampleTransaction('production', '/auth/callback')).toBe(PRODUCTION_CRITICAL_TRACE_RATE);
    expect(sampleTransaction('production', '/paper-trading')).toBe(PRODUCTION_CRITICAL_TRACE_RATE);
  });
});

describe('buildSentryOptions', () => {
  it('disables default PII collection and session replay', () => {
    const options = buildSentryOptions({ MODE: 'production', VITE_SENTRY_DSN: 'https://k@s.io/1' });
    expect(options.sendDefaultPii).toBe(false);
    expect(options.replaysSessionSampleRate).toBe(0);
    expect(options.replaysOnErrorSampleRate).toBe(0);
    expect(
      (options.integrations as { name: string }[]).some((i) => /replay/i.test(i.name))
    ).toBe(false);
  });

  it('wires redaction into beforeSend hooks', () => {
    const options = buildSentryOptions({ MODE: 'production', VITE_SENTRY_DSN: 'https://k@s.io/1' });
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeSendTransaction).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
    expect(typeof options.tracesSampler).toBe('function');
  });

  it('tags environment and release SHA', () => {
    const options = buildSentryOptions({
      MODE: 'production',
      VITE_SENTRY_DSN: 'https://k@s.io/1',
      VITE_RELEASE_SHA: 'abc1234',
    });
    expect(options.environment).toBe('production');
    expect(options.release).toBe('abc1234');
  });
});

describe('getReleaseSha', () => {
  it('prefers the explicit release variable and falls back to Vercel', () => {
    expect(getReleaseSha({ MODE: 'production', VITE_RELEASE_SHA: 'aaa' })).toBe('aaa');
    expect(getReleaseSha({ MODE: 'production', VITE_VERCEL_GIT_COMMIT_SHA: 'bbb' })).toBe('bbb');
    expect(getReleaseSha({ MODE: 'production' })).toBeUndefined();
  });
});
