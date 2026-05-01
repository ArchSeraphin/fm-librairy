import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAndNormalize } from '../../../worker/lib/metadata/cover-storage.js';

let agent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;
let storageRoot: string;

beforeEach(async () => {
  originalDispatcher = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  storageRoot = await mkdtemp(join(tmpdir(), 'cover-test-'));
  process.env.STORAGE_ROOT = storageRoot;
  process.env.COVER_MAX_BYTES = String(5 * 1024 * 1024);
  process.env.METADATA_FETCH_TIMEOUT_MS = '10000';
});
afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await rm(storageRoot, { recursive: true, force: true });
});

describe('downloadAndNormalize — reject', () => {
  it('returns null on PDF bytes with .jpg extension (magic-byte mismatch)', async () => {
    const fake = await readFile('tests/fixtures/metadata/cover-fake-pdf.jpg');
    agent.get('https://cover.example').intercept({ path: '/p.jpg' }).reply(200, fake);
    expect(await downloadAndNormalize('https://cover.example/p.jpg', 'ckabc123')).toBeNull();
  });

  it('returns null when payload exceeds COVER_MAX_BYTES', async () => {
    const big = await readFile('tests/fixtures/metadata/cover-oversized.bin');
    agent.get('https://cover.example').intercept({ path: '/big' }).reply(200, big, {
      headers: { 'content-length': String(big.length) },
    });
    expect(await downloadAndNormalize('https://cover.example/big', 'ckabc123')).toBeNull();
  });

  it('returns null on HTTP 404', async () => {
    agent.get('https://cover.example').intercept({ path: '/missing' }).reply(404, '');
    expect(await downloadAndNormalize('https://cover.example/missing', 'ckabc123')).toBeNull();
  });

  it('returns null on timeout', async () => {
    process.env.METADATA_FETCH_TIMEOUT_MS = '50';
    agent.get('https://cover.example').intercept({ path: '/slow' }).reply(200, async () => {
      await new Promise((r) => setTimeout(r, 200));
      return Buffer.from('x');
    });
    expect(await downloadAndNormalize('https://cover.example/slow', 'ckabc123')).toBeNull();
  });
});
