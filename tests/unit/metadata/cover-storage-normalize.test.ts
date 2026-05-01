import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
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
});
afterEach(async () => {
  setGlobalDispatcher(originalDispatcher);
  await rm(storageRoot, { recursive: true, force: true });
});

describe('downloadAndNormalize — normalize', () => {
  it('downloads JPEG and writes JPEG under STORAGE_ROOT/covers/', async () => {
    const sample = await readFile('tests/fixtures/metadata/cover-sample.jpg');
    agent.get('https://cover.example').intercept({ path: '/x.jpg' }).reply(200, sample, {
      headers: { 'content-type': 'image/jpeg' },
    });
    const result = await downloadAndNormalize('https://cover.example/x.jpg', 'ckabc123');
    expect(result).not.toBeNull();
    expect(result!.relPath).toBe('covers/ckabc123.jpg');
    const written = await stat(join(storageRoot, 'covers', 'ckabc123.jpg'));
    expect(written.size).toBeGreaterThan(0);
  });

  it('atomically replaces an existing cover', async () => {
    const sample = await readFile('tests/fixtures/metadata/cover-sample.jpg');
    agent.get('https://cover.example').intercept({ path: '/x.jpg' }).reply(200, sample, {
      headers: { 'content-type': 'image/jpeg' },
    }).times(2);
    await downloadAndNormalize('https://cover.example/x.jpg', 'ckabc123');
    const result = await downloadAndNormalize('https://cover.example/x.jpg', 'ckabc123');
    expect(result).not.toBeNull();
  });
});
