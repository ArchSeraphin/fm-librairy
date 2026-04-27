import { describe, it, expect } from 'vitest';
import { safeCallbackUrl } from '@/lib/utils';

describe('safeCallbackUrl', () => {
  it('returns the candidate when same-origin path', () => {
    expect(safeCallbackUrl('/admin', '/x')).toBe('/admin');
    expect(safeCallbackUrl('/admin/users?tab=1', '/x')).toBe('/admin/users?tab=1');
  });
  it('returns fallback when null/undefined/empty', () => {
    expect(safeCallbackUrl(null, '/x')).toBe('/x');
    expect(safeCallbackUrl(undefined, '/x')).toBe('/x');
    expect(safeCallbackUrl('', '/x')).toBe('/x');
  });
  it('returns fallback for absolute URLs', () => {
    expect(safeCallbackUrl('https://evil.tld', '/x')).toBe('/x');
    expect(safeCallbackUrl('http://evil.tld/admin', '/x')).toBe('/x');
  });
  it('returns fallback for protocol-relative URLs', () => {
    expect(safeCallbackUrl('//evil.tld', '/x')).toBe('/x');
    expect(safeCallbackUrl('//evil.tld/admin', '/x')).toBe('/x');
  });
  it('returns fallback for non-rooted relative paths', () => {
    expect(safeCallbackUrl('admin', '/x')).toBe('/x');
    expect(safeCallbackUrl('../admin', '/x')).toBe('/x');
  });
});
