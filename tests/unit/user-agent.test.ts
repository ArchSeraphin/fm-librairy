import { describe, expect, it } from 'vitest';
import { parseUserAgentLabel } from '@/lib/user-agent';

describe('parseUserAgentLabel', () => {
  it('detects Chrome on macOS', () => {
    expect(
      parseUserAgentLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
  });
  it('detects Safari on iOS', () => {
    expect(
      parseUserAgentLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS');
  });
  it('detects Firefox on Windows', () => {
    expect(
      parseUserAgentLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      ),
    ).toBe('Firefox on Windows');
  });
  it('returns null on empty', () => {
    expect(parseUserAgentLabel('')).toBeNull();
  });
});
