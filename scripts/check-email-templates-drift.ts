#!/usr/bin/env tsx
// Normalisations tolerées : le prefix DUPLICATED est documentaire, le suffix .js est
// requis par la résolution ESM/NodeNext du worker, et &apos; est l'équivalent JSX de '
// (ce qui produit des retours à la ligne différents dans le JSX — même rendu HTML).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const SRC = 'src/emails';
const WORKER = 'worker/emails';

function normalize(content: Buffer): string {
  let text = content.toString('utf8');

  // a) Strip leading DUPLICATED comment block: the first line contains "DUPLICATED"
  //    and any immediately following lines that contain "DUPLICATED" or "chose duplication"
  //    (the two-line pattern used in worker/emails files), plus an optional blank line after.
  text = text.replace(
    /^(\/\/[^\n]*DUPLICATED[^\n]*\n(?:\/\/[^\n]*(?:DUPLICATED|chose duplication)[^\n]*\n)*)\n?/,
    '',
  );

  // b) Normalize import paths: remove .js suffix from relative imports.
  text = text.replace(/from '(\.[^']+)\.js'/g, "from '$1'");

  // c) Normalize JSX apostrophe entity to raw apostrophe.
  text = text.replace(/&apos;/g, "'");

  // d) Normalize JSX text line-wrapping: joining a text continuation onto the previous
  //    line collapses the cosmetic wrap difference caused by &apos; → ' length change.
  text = text.replace(/([^\n<>{};])\n\s+([^\s<>{};])/g, '$1 $2');

  // e) Normalize line endings and trim trailing whitespace per line.
  text = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .join('\n');

  return text;
}

function hashesIn(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const entries = readdirSync(dir);
  for (const f of entries) {
    const path = join(dir, f);
    if (!statSync(path).isFile()) continue;
    const normalized = normalize(readFileSync(path));
    const sha = createHash('sha256').update(normalized).digest('hex');
    out.set(f, sha);
  }
  return out;
}

const a = hashesIn(SRC);
const b = hashesIn(WORKER);

const diffs: string[] = [];
const onlyInSrc: string[] = [];
const onlyInWorker: string[] = [];
for (const [f, ha] of a) {
  const hb = b.get(f);
  if (hb === undefined) onlyInSrc.push(f);
  else if (ha !== hb) diffs.push(f);
}
for (const f of b.keys()) if (!a.has(f)) onlyInWorker.push(f);

if (diffs.length || onlyInSrc.length || onlyInWorker.length) {
  console.error('Email templates drift detected between src/emails and worker/emails:\n');
  if (diffs.length) console.error('  Modified (different SHA-256):', diffs.join(', '));
  if (onlyInSrc.length) console.error('  Only in src/emails:', onlyInSrc.join(', '));
  if (onlyInWorker.length) console.error('  Only in worker/emails:', onlyInWorker.join(', '));
  console.error('\nReconcile via the runbook: docs/runbooks/email-templates-sync.md');
  process.exit(1);
}
console.log('Email templates in sync (' + a.size + ' files).');
