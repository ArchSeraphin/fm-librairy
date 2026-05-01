import { fetch, type Response } from 'undici';
import { ProviderTransientError, type NormalizedPayload } from './types.js';

const ENDPOINT = 'https://openlibrary.org/api/books';
const TIMEOUT_MS = Number(process.env.METADATA_FETCH_TIMEOUT_MS ?? 10_000);

interface OLBook {
  publishers?: Array<{ name: string }>;
  publish_date?: string;
  notes?: string | { value: string };
  excerpts?: Array<{ text: string }>;
  cover?: { large?: string; medium?: string; small?: string };
  languages?: Array<{ key: string }>;
  description?: string | { value: string };
}

function parseYear(s?: string): number | null {
  if (!s) return null;
  const m = /\b\d{4}\b/.exec(s);
  return m ? Number(m[0]) : null;
}

function langKeyToIso2(key?: string): string | null {
  if (!key) return null;
  const code = key.replace('/languages/', '').toLowerCase();
  const map: Record<string, string> = {
    fre: 'fr',
    fra: 'fr',
    eng: 'en',
    spa: 'es',
    ger: 'de',
    deu: 'de',
    ita: 'it',
  };
  return map[code] ?? (code.length === 2 ? code : null);
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'value' in (v as object)) {
    const val = (v as { value: unknown }).value;
    return typeof val === 'string' ? val : null;
  }
  return null;
}

export async function fetchByIsbn(isbn: string): Promise<NormalizedPayload | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('bibkeys', `ISBN:${isbn}`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('jscmd', 'data');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': process.env.OPEN_LIBRARY_USER_AGENT ?? 'BiblioShare/2B' },
    });
  } catch (err) {
    throw new ProviderTransientError(`open-library fetch failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    throw new ProviderTransientError(`open-library HTTP ${res.status}`, res.status);
  }
  if (!res.ok) return null;

  const data = (await res.json()) as Record<string, OLBook>;
  const book = data[`ISBN:${isbn}`];
  if (!book) return null;

  return {
    source: 'OPEN_LIBRARY',
    description:
      asString(book.description) ?? asString(book.notes) ?? book.excerpts?.[0]?.text ?? null,
    publisher: book.publishers?.[0]?.name ?? null,
    publishedYear: parseYear(book.publish_date),
    language: langKeyToIso2(book.languages?.[0]?.key),
    coverUrl: book.cover?.large ?? book.cover?.medium ?? book.cover?.small ?? null,
  };
}
