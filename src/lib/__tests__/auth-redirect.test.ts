import { describe, it, expect } from 'vitest';
import { sanitizeReturnPath, buildAuthCallbackUrl } from '../auth-redirect';

describe('sanitizeReturnPath', () => {
  it('returns default for empty or missing paths', () => {
    expect(sanitizeReturnPath()).toBe('/advisor');
    expect(sanitizeReturnPath('')).toBe('/advisor');
    expect(sanitizeReturnPath(null)).toBe('/advisor');
  });

  it('accepts safe relative paths', () => {
    expect(sanitizeReturnPath('/onboarding')).toBe('/onboarding');
    expect(sanitizeReturnPath('/advisor')).toBe('/advisor');
    expect(sanitizeReturnPath('/profile')).toBe('/profile');
  });

  it('rejects protocol-relative paths', () => {
    expect(sanitizeReturnPath('//evil.com')).toBe('/advisor');
  });

  it('rejects absolute URLs', () => {
    expect(sanitizeReturnPath('https://evil.com')).toBe('/advisor');
    expect(sanitizeReturnPath('http://evil.com/path')).toBe('/advisor');
  });

  it('rejects dangerous schemes', () => {
    expect(sanitizeReturnPath('javascript:alert(1)')).toBe('/advisor');
    expect(sanitizeReturnPath('/path?x=javascript:alert(1)')).toBe('/advisor');
  });

  it('rejects paths without leading slash', () => {
    expect(sanitizeReturnPath('advisor')).toBe('/advisor');
  });

  it('rejects backslash paths', () => {
    expect(sanitizeReturnPath('/path\\evil')).toBe('/advisor');
  });
});

describe('buildAuthCallbackUrl', () => {
  it('builds callback URL with sanitized next param', () => {
    const url = buildAuthCallbackUrl('/onboarding');
    expect(url).toContain('/auth/callback');
    expect(url).toContain('next=%2Fonboarding');
  });

  it('falls back to default path for unsafe input', () => {
    const url = buildAuthCallbackUrl('https://evil.com');
    expect(url).toContain('next=%2Fadvisor');
  });
});
