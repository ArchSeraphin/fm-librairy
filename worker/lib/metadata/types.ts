export type MetadataSource = 'GOOGLE_BOOKS' | 'OPEN_LIBRARY';
export type MetadataFetchMode = 'auto' | 'manual';

export interface NormalizedPayload {
  source: MetadataSource;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null; // ISO 639-1, lowercase
  coverUrl: string | null; // HTTPS absolute
}

export class ProviderTransientError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderTransientError';
  }
}
