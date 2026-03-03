import { describe, expect, it } from 'vitest';
import { toSafeExternalUrl } from '../url';

describe('toSafeExternalUrl', () => {
  it('accepts HTTPS URLs', () => {
    expect(toSafeExternalUrl('https://example.com/news/1')).toBe('https://example.com/news/1');
  });

  it('accepts HTTP URLs', () => {
    expect(toSafeExternalUrl('http://example.com/news/2')).toBe('http://example.com/news/2');
  });

  it('rejects javascript URLs', () => {
    expect(toSafeExternalUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects data URLs', () => {
    expect(toSafeExternalUrl('data:text/html;base64,SGVsbG8=')).toBeNull();
  });

  it('rejects relative URLs', () => {
    expect(toSafeExternalUrl('/news/local-path')).toBeNull();
  });

  it('rejects empty and null values', () => {
    expect(toSafeExternalUrl('')).toBeNull();
    expect(toSafeExternalUrl(null)).toBeNull();
    expect(toSafeExternalUrl(undefined)).toBeNull();
  });
});
