import { describe, it, expect } from 'vitest';
import {
  stagingPath,
  finalPath,
  assertUnderRoot,
} from '@/lib/upload/storage-paths';

const ROOT = '/tmp/biblio-test';

describe('stagingPath', () => {
  it('returns /tmp/biblio-test/staging/<sha>.<ext>', () => {
    expect(stagingPath(ROOT, 'abc123', 'epub')).toBe(
      '/tmp/biblio-test/staging/abc123.epub',
    );
  });
});

describe('finalPath', () => {
  it('returns /tmp/biblio-test/library/<libId>/<bookId>/<sha>.<ext>', () => {
    expect(finalPath(ROOT, 'libX', 'bookY', 'abc123', 'pdf')).toBe(
      '/tmp/biblio-test/library/libX/bookY/abc123.pdf',
    );
  });
});

describe('assertUnderRoot', () => {
  it('passes when path is inside root', () => {
    expect(() => assertUnderRoot(ROOT, '/tmp/biblio-test/staging/x.epub')).not.toThrow();
  });
  it('throws on path traversal via ..', () => {
    expect(() => assertUnderRoot(ROOT, '/tmp/biblio-test/../etc/passwd')).toThrow(/PATH_TRAVERSAL/);
  });
  it('throws when path escapes root entirely', () => {
    expect(() => assertUnderRoot(ROOT, '/etc/passwd')).toThrow(/PATH_TRAVERSAL/);
  });
});
