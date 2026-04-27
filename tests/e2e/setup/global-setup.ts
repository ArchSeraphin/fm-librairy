/**
 * Playwright globalSetup — loads .env.local into the test process so that
 * helper code (encryptSecret, hashPassword, hashIp, …) can read crypto keys.
 *
 * NOTE: webServer is started by Playwright BEFORE globalSetup, so injecting
 * env vars here cannot influence the dev server's port or DB. The dev server
 * reads `.env.local` itself. We only need globalSetup to ensure the *test
 * process* has the same secrets so test fixtures encrypt with the same keys
 * the server will decrypt with.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

function loadDotEnv(filePath: string): void {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function globalSetup(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..', '..');
  loadDotEnv(path.join(root, '.env.local'));
  loadDotEnv(path.join(root, '.env'));
}

export default globalSetup;
