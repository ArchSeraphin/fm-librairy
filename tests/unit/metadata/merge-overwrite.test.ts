import { describe, it, expect } from 'vitest';
import { applyPolicy } from '../../../worker/lib/metadata/merge.js';
import type { NormalizedPayload } from '../../../worker/lib/metadata/types.js';

const merged: NormalizedPayload = {
  source: 'OPEN_LIBRARY',
  description: 'Fresh desc.',
  publisher: 'Fresh Pub.',
  publishedYear: 2024,
  language: 'fr',
  coverUrl: null,
};

describe('applyPolicy(mode=manual)', () => {
  it('overwrites every non-null field even when current is set', () => {
    const patch = applyPolicy(
      { description: 'Old.', publisher: 'Old Pub.', publishedYear: 1990, language: 'en', coverPath: null },
      merged,
      'manual',
    );
    expect(patch.description).toBe('Fresh desc.');
    expect(patch.publisher).toBe('Fresh Pub.');
    expect(patch.publishedYear).toBe(2024);
    expect(patch.language).toBe('fr');
    expect(patch.metadataSource).toBe('OPEN_LIBRARY');
  });

  it('does not include fields the merged payload has null', () => {
    const partial: NormalizedPayload = {
      source: 'GOOGLE_BOOKS',
      description: 'Only desc.',
      publisher: null, publishedYear: null, language: null, coverUrl: null,
    };
    const patch = applyPolicy(
      { description: 'X', publisher: 'X', publishedYear: 1, language: 'x', coverPath: null },
      partial,
      'manual',
    );
    expect(patch.description).toBe('Only desc.');
    expect(patch).not.toHaveProperty('publisher');
    expect(patch).not.toHaveProperty('publishedYear');
    expect(patch).not.toHaveProperty('language');
  });
});
