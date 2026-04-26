import { Meilisearch } from 'meilisearch';
import { getEnv } from './env';

const globalForMeili = globalThis as unknown as { meili: Meilisearch | undefined };

export function getMeili(): Meilisearch {
  if (globalForMeili.meili) return globalForMeili.meili;
  const env = getEnv();
  const meili = new Meilisearch({
    host: env.MEILI_HOST,
    apiKey: env.MEILI_MASTER_KEY,
  });
  if (process.env.NODE_ENV !== 'production') globalForMeili.meili = meili;
  return meili;
}
