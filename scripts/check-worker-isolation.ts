// scripts/check-worker-isolation.ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'worker');
const FORBIDDEN = /from\s+['"`](\.\.\/)+src\//;

const offenders: Array<{ file: string; match: string }> = [];
function walk(dir: string) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.(m?ts|m?js)$/.test(entry)) continue;
    const text = readFileSync(p, 'utf-8');
    for (const line of text.split('\n')) {
      const m = FORBIDDEN.exec(line);
      if (m) offenders.push({ file: relative(process.cwd(), p), match: line.trim() });
    }
  }
}
walk(ROOT);

if (offenders.length) {
  console.error('Worker self-containment violation: imports from src/ are forbidden.');
  for (const o of offenders) console.error(`  ${o.file}: ${o.match}`);
  process.exit(1);
}
console.log('worker/: no src/ imports — OK');
