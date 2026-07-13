/**
 * Guards the production security headers in vercel.json (issue #209).
 * If these fail, the CSP or a hardening header regressed — fix the config,
 * do not loosen the assertions without a security review.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface VercelHeader {
  key: string;
  value: string;
}

interface VercelConfig {
  headers: { source: string; headers: VercelHeader[] }[];
}

function loadProductionHeaders(): Map<string, string> {
  const raw = readFileSync(resolve(__dirname, '../../vercel.json'), 'utf-8');
  const config = JSON.parse(raw) as VercelConfig;
  const catchAll = config.headers.find((entry) => entry.source === '/(.*)');
  expect(catchAll).toBeDefined();
  return new Map(catchAll!.headers.map((h) => [h.key, h.value]));
}

function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      directives.set(tokens[0], tokens.slice(1));
    }
  }
  return directives;
}

describe('production Content-Security-Policy (vercel.json)', () => {
  const headers = loadProductionHeaders();
  const csp = parseCsp(headers.get('Content-Security-Policy') ?? '');

  it('does not allow inline or remote-eval scripts', () => {
    const scriptSrc = csp.get('script-src');
    expect(scriptSrc).toEqual(["'self'"]);
  });

  it('blocks plugins, frames, and framing', () => {
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('frame-src')).toEqual(["'none'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('restricts base URI and form targets', () => {
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
  });

  it('keeps default-src self and upgrades insecure requests', () => {
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.has('upgrade-insecure-requests')).toBe(true);
  });

  it('never allows wildcard connect targets', () => {
    const connectSrc = csp.get('connect-src') ?? [];
    expect(connectSrc).not.toContain('*');
    expect(connectSrc).not.toContain('http:');
    // Production must not talk to localhost backends.
    expect(connectSrc.some((s) => s.includes('localhost'))).toBe(false);
  });
});

describe('other production security headers (vercel.json)', () => {
  const headers = loadProductionHeaders();

  it('keeps clickjacking and MIME hardening headers', () => {
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });
});

describe('index.html', () => {
  it('contains no inline script bodies (CSP script-src has no unsafe-inline in production)', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1].trim())
      .filter((body) => body.length > 0);
    expect(inlineScripts).toEqual([]);
  });
});
