import { describe, it, expect } from 'vitest';
import { mergePayloads } from '../../../worker/lib/metadata/merge.js';
import type { NormalizedPayload } from '../../../worker/lib/metadata/types.js';

const google: NormalizedPayload = {
  source: 'GOOGLE_BOOKS',
  description: 'A great book.',
  publisher: null,
  publishedYear: 1943,
  language: 'fr',
  coverUrl: 'https://google/cover.jpg',
};
const openLib: NormalizedPayload = {
  source: 'OPEN_LIBRARY',
  description: 'Different desc.',
  publisher: 'Gallimard',
  publishedYear: null,
  language: 'fr',
  coverUrl: null,
};

describe('mergePayloads', () => {
  it('takes first non-null per field, source = first to contribute', () => {
    const merged = mergePayloads([google, openLib]);
    expect(merged.description).toBe('A great book.');
    expect(merged.publisher).toBe('Gallimard'); // google had null
    expect(merged.publishedYear).toBe(1943);
    expect(merged.coverUrl).toBe('https://google/cover.jpg');
    expect(merged.source).toBe('GOOGLE_BOOKS');
  });

  it('returns null payload when all sources are empty', () => {
    const empty: NormalizedPayload = {
      source: 'GOOGLE_BOOKS',
      description: null,
      publisher: null,
      publishedYear: null,
      language: null,
      coverUrl: null,
    };
    expect(mergePayloads([empty])).toEqual(empty);
  });

  it('skips entirely-null sources for the source attribution', () => {
    const empty: NormalizedPayload = {
      source: 'GOOGLE_BOOKS',
      description: null,
      publisher: null,
      publishedYear: null,
      language: null,
      coverUrl: null,
    };
    const merged = mergePayloads([empty, openLib]);
    expect(merged.source).toBe('OPEN_LIBRARY');
    expect(merged.description).toBe('Different desc.');
  });
});
