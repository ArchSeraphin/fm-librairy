import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFileSync } from 'node:fs';
import { fetchByIsbn } from '../../../worker/lib/metadata/google-books-client.js';
import { ProviderTransientError } from '../../../worker/lib/metadata/types.js';

let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});
afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

describe('googleBooks.fetchByIsbn', () => {
  it('returns normalized payload for Le Petit Prince fixture', async () => {
    const body = readFileSync('tests/fixtures/metadata/google-books-9782070612758.json', 'utf-8');
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(200, body);

    const payload = await fetchByIsbn('9782070612758');
    expect(payload).not.toBeNull();
    expect(payload!.source).toBe('GOOGLE_BOOKS');
    expect(payload!.language).toBe('fr');
    expect(payload!.publishedYear).toBeGreaterThan(1900);
    expect(payload!.coverUrl).toMatch(/^https:\/\//);
  });

  it('returns null when totalItems = 0', async () => {
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(200, { totalItems: 0, items: [] });
    expect(await fetchByIsbn('0000000000000')).toBeNull();
  });

  it('returns null on 404', async () => {
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(404, '');
    expect(await fetchByIsbn('1111111111111')).toBeNull();
  });

  it('throws ProviderTransientError on 503', async () => {
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(503, 'try later');
    await expect(fetchByIsbn('9782070612758')).rejects.toBeInstanceOf(ProviderTransientError);
  });

  it('throws ProviderTransientError on 429', async () => {
    agent
      .get('https://www.googleapis.com')
      .intercept({ path: /\/books\/v1\/volumes/, method: 'GET' })
      .reply(429, 'rate limited');
    await expect(fetchByIsbn('9782070612758')).rejects.toBeInstanceOf(ProviderTransientError);
  });
});
