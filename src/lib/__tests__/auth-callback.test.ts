import { describe, it, expect } from 'vitest';
import { getOAuthErrorMessage } from '../auth-callback';

describe('getOAuthErrorMessage', () => {
  it('returns null when no error is present', () => {
    expect(getOAuthErrorMessage(null, null)).toBeNull();
  });

  it('returns a friendly message for cancelled Google sign-in', () => {
    expect(getOAuthErrorMessage('access_denied', null)).toMatch(/cancelled/i);
  });

  it('uses the provider description when available', () => {
    expect(getOAuthErrorMessage('server_error', 'Provider unavailable')).toBe('Provider unavailable');
  });

  it('falls back to a generic message', () => {
    expect(getOAuthErrorMessage('unknown_error', null)).toMatch(/not completed/i);
  });
});
