# Runbook — Email templates sync (src/emails ↔ worker/emails)

The drift guard fails CI when these directories diverge. Two trees
exist because the worker package compiles independently from the Next.js
app and may need its own bundled copies.

## Tolerated differences

The guard normalizes the following **intentional** differences before hashing.
A textual `diff` between the two trees will show these; a hash diff after
normalization indicates real, unintended divergence:

1. **DUPLICATED header** — every `worker/emails/*.tsx` file starts with a
   two-line comment block (`// DUPLICATED from src/emails/... — keep in sync.
Phase 1B / chose duplication over a shared workspace package; revisit in
Phase 2+.`). This is documentation; it is stripped before hashing.

2. **`.js` import suffix** — `worker/emails/*.tsx` files use `from './_layout.js'`
   instead of `from './_layout'`. This is required by the worker's
   NodeNext/ESM module resolution in compiled output; the suffix is removed
   before hashing.

3. **JSX apostrophe entity** — `src/emails/*.tsx` files use `&apos;` (JSX-lint
   friendly) while `worker/emails/*.tsx` files use a raw `'`. Both render to
   the same HTML. The entity is replaced with `'` before hashing. Because the
   two representations have different byte lengths they can cause cosmetic line
   wrap differences; those are also collapsed before hashing.

## When CI fails

1. Identify the drifting file from the CI log.
2. Decide which version is correct (usually whichever was edited most
   recently — check `git log -- <file>` in both paths).
3. Copy the canonical version to the other location.
4. Re-run `pnpm check:emails-drift` locally to confirm.
5. Commit with message `chore(emails): sync templates`.

## Long-term fix

A single source of truth is the goal — Phase 2 is a likely candidate to
introduce a shared package or a build-time copy step. Until then, this
guard keeps the two trees honest.
