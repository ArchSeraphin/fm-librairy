// tests/integration/clamav-client.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanFile, ScanVerdict } from '../../worker/lib/clamav';

const HOST = process.env.CLAMAV_HOST ?? 'localhost';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

let cleanFile: string;
let infectedFile: string;

beforeAll(() => {
  const dir = path.join(tmpdir(), `biblio-clamav-test-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  cleanFile = path.join(dir, 'clean.txt');
  infectedFile = path.join(dir, 'eicar.txt');
  writeFileSync(cleanFile, 'BiblioShare test — clean file.');
  writeFileSync(infectedFile, EICAR);
});

describe('scanFile', () => {
  it('returns CLEAN for benign file', async () => {
    const r = await scanFile(cleanFile, { host: HOST, port: PORT });
    expect(r.verdict).toBe<ScanVerdict>('CLEAN');
  });

  it('returns INFECTED with virus name for EICAR', async () => {
    const r = await scanFile(infectedFile, { host: HOST, port: PORT });
    expect(r.verdict).toBe<ScanVerdict>('INFECTED');
    expect(r.virusName).toMatch(/EICAR/i);
  });
});
