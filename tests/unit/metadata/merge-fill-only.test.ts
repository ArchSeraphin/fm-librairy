import { describe, it, expect } from 'vitest';
import { applyPolicy } from '../../../worker/lib/metadata/merge.js';
import type { NormalizedPayload } from '../../../worker/lib/metadata/types.js';

const merged: NormalizedPayload = {
  source: 'GOOGLE_BOOKS',
  description: 'New desc.',
  publisher: 'New Pub.',
  publishedYear: 2020,
  language: 'fr',
  coverUrl: 'https://x/cover.jpg',
};

describe('applyPolicy(mode=auto)', () => {
  it('writes only fields where current is null', () => {
    const patch = applyPolicy(
      { description: null, publisher: 'Old Pub.', publishedYear: null, language: 'en', coverPath: null },
      merged,
      'auto',
    );
    expect(patch.description).toBe('New desc.');
    expect(patch.publisher).toBeUndefined(); // already set
    expect(patch.publishedYear).toBe(2020);
    expect(patch.language).toBeUndefined(); // already set
  });

  it('treats empty string and 0 as "set" (admin explicitly cleared)', () => {
    const patch = applyPolicy(
      { description: '', publisher: '', publishedYear: 0, language: '', coverPath: null },
      merged,
      'auto',
    );
    expect(patch.description).toBeUndefined();
    expect(patch.publisher).toBeUndefined();
    expect(patch.publishedYear).toBeUndefined();
    expect(patch.language).toBeUndefined();
  });

  it('attaches metadataSource when at least one field was written', () => {
    const patch = applyPolicy(
      { description: null, publisher: null, publishedYear: null, language: null, coverPath: null },
      merged,
      'auto',
    );
    expect(patch.metadataSource).toBe('GOOGLE_BOOKS');
  });
});
