import { describe, expect, it } from 'vitest';
import { extractIpFromHeaders } from '@/lib/request-meta';

describe('extractIpFromHeaders', () => {
  it('extracts first hop from x-forwarded-for', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5, 198.51.100.1, 10.0.0.1' });
    expect(extractIpFromHeaders(h)).toBe('203.0.113.5');
  });

  it('uses x-forwarded-for single value', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.5' });
    expect(extractIpFromHeaders(h)).toBe('203.0.113.5');
  });

  it('falls back to x-real-ip when no x-forwarded-for', () => {
    const h = new Headers({ 'x-real-ip': '198.51.100.42' });
    expect(extractIpFromHeaders(h)).toBe('198.51.100.42');
  });

  it('returns 0.0.0.0 when no header present', () => {
    expect(extractIpFromHeaders(new Headers())).toBe('0.0.0.0');
  });

  it('returns 0.0.0.0 on malformed value', () => {
    const h = new Headers({ 'x-forwarded-for': 'not-an-ip' });
    expect(extractIpFromHeaders(h)).toBe('0.0.0.0');
  });

  it('accepts IPv6 address', () => {
    const h = new Headers({ 'x-forwarded-for': '2001:db8::1' });
    expect(extractIpFromHeaders(h)).toBe('2001:db8::1');
  });
});
