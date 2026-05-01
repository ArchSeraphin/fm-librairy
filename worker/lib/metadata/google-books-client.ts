import { fetch } from 'undici';
import { ProviderTransientError, type NormalizedPayload } from './types.js';

const ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const TIMEOUT_MS = Number(process.env.METADATA_FETCH_TIMEOUT_MS ?? 10_000);

interface GBVolume {
  volumeInfo?: {
    description?: string;
    publisher?: string;
    publishedDate?: string;
    language?: string;
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

function parseYear(s?: string): number | null {
  if (!s) return null;
  const m = /^\d{4}/.exec(s);
  return m ? Number(m[0]) : null;
}

function normalizeCoverUrl(u?: string): string | null {
  if (!u) return null;
  return u.replace(/^http:/, 'https:');
}

export async function fetchByIsbn(isbn: string): Promise<NormalizedPayload | null> {
  const url = new URL(ENDPOINT);
  url.searchParams.set('q', `isbn:${isbn}`);
  if (process.env.GOOGLE_BOOKS_API_KEY) {
    url.searchParams.set('key', process.env.GOOGLE_BOOKS_API_KEY);
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ac.signal });
  } catch (err) {
    throw new ProviderTransientError(`google-books fetch failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 404) return null;
  if (res.status === 429 || res.status >= 500) {
    throw new ProviderTransientError(`google-books HTTP ${res.status}`, res.status);
  }
  if (!res.ok) return null;

  const data = (await res.json()) as { totalItems?: number; items?: GBVolume[] };
  const v = data.items?.[0]?.volumeInfo;
  if (!v) return null;

  return {
    source: 'GOOGLE_BOOKS',
    description: v.description ?? null,
    publisher: v.publisher ?? null,
    publishedYear: parseYear(v.publishedDate),
    language: v.language ? v.language.toLowerCase() : null,
    coverUrl: normalizeCoverUrl(v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail),
  };
}
