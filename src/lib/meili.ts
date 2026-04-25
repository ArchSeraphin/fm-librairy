import { Meilisearch } from 'meilisearch';
import { getEnv } from './env';

const env = getEnv();

const globalForMeili = globalThis as unknown as { meili: Meilisearch | undefined };

export const meili =
  globalForMeili.meili ??
  new Meilisearch({
    host: env.MEILI_HOST,
    apiKey: env.MEILI_MASTER_KEY,
  });

if (process.env.NODE_ENV !== 'production') globalForMeili.meili = meili;
