import { describe, it, expect } from 'vitest';
import { getErrorMessage } from '../error';

describe('getErrorMessage', () => {
  it('extracts message from Error object', () => {
    const error = new Error('Test error message');
    expect(getErrorMessage(error)).toBe('Test error message');
  });

  it('handles string errors', () => {
    expect(getErrorMessage('String error')).toBe('String error');
  });

  it('handles object errors by stringifying', () => {
    const error = { message: 'Custom error message', code: 500 };
    const result = getErrorMessage(error);
    expect(result).toContain('message');
    expect(result).toContain('Custom error message');
  });

  it('handles null and undefined', () => {
    // JSON.stringify(null) returns "null"
    expect(getErrorMessage(null)).toBe('null');
    // JSON.stringify(undefined) returns undefined (not a string)
    // The function returns undefined when JSON.stringify returns undefined
    expect(getErrorMessage(undefined)).toBeUndefined();
  });

  it('handles circular references gracefully', () => {
    const circular: any = { prop: 'value' };
    circular.self = circular;
    const result = getErrorMessage(circular);
    expect(result).toBe('Unknown error');
  });
});
