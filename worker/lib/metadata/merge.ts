// worker/lib/metadata/merge.ts
import type { NormalizedPayload, MetadataFetchMode, MetadataSource } from './types.js';

const FIELDS = ['description', 'publisher', 'publishedYear', 'language', 'coverUrl'] as const;
type Field = (typeof FIELDS)[number];

function isNonEmpty(p: NormalizedPayload): boolean {
  return FIELDS.some((f) => p[f] !== null);
}

export function mergePayloads(payloads: NormalizedPayload[]): NormalizedPayload {
  const merged: NormalizedPayload = {
    source: payloads[0]?.source ?? 'GOOGLE_BOOKS',
    description: null, publisher: null, publishedYear: null,
    language: null, coverUrl: null,
  };
  let attributedSource: MetadataSource | null = null;

  for (const p of payloads) {
    if (!attributedSource && isNonEmpty(p)) attributedSource = p.source;
    for (const f of FIELDS) {
      if (merged[f] === null && p[f] !== null) {
        // @ts-expect-error narrow per-field
        merged[f] = p[f];
      }
    }
  }
  if (attributedSource) merged.source = attributedSource;
  return merged;
}

type CurrentBookFields = {
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  coverPath: string | null;
};

type BookPatch = Partial<{
  description: string;
  publisher: string;
  publishedYear: number;
  language: string;
  metadataSource: 'GOOGLE_BOOKS' | 'OPEN_LIBRARY';
}>;

export function applyPolicy(
  current: CurrentBookFields,
  merged: NormalizedPayload,
  mode: MetadataFetchMode,
): BookPatch {
  const patch: BookPatch = {};
  const writable: Array<keyof CurrentBookFields & keyof NormalizedPayload> = [
    'description', 'publisher', 'publishedYear', 'language',
  ];
  let wroteAny = false;

  for (const f of writable) {
    const newVal = merged[f];
    if (newVal === null) continue;
    const shouldWrite =
      mode === 'manual'
        ? true
        : current[f] === null; // auto = fill-only on strictly null
    if (shouldWrite) {
      // @ts-expect-error narrow per-field
      patch[f] = newVal;
      wroteAny = true;
    }
  }

  if (wroteAny || merged.coverUrl !== null) {
    patch.metadataSource = merged.source;
  }
  return patch;
}
