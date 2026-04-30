# Architecture — Session bridge

## What

`src/server/auth/session-bridge.ts` is the single bridge between Auth.js v5
sessions stored in the database and the rest of our server-side code (Next.js
server components, Route Handlers, tRPC procedures).

## Why parse user agent instead of hashing?

The `Session.userAgentLabel` field holds a human-readable label like
"Chrome on macOS" rather than a hash of the raw UA string. Two reasons:

1. **Operator UX** — when a user reviews their active sessions in
   `/account/security`, the labels need to be meaningful. A hash is
   useless to humans.

2. **Privacy** — we don't store the raw UA at all (it would tie the
   session to a fingerprintable browser version). The parsed label
   coarsens the data: `"Firefox 137 on Linux"` becomes `"Firefox on
   Linux"`.

The parser lives at `src/lib/user-agent.ts` and uses a small allowlist
(no third-party UA-parsing dep). New browsers fall back to `"Other"`
rather than to the raw UA — a deliberate choice (privacy over
specificity).

## Trade-off accepted

A user with two Firefox sessions on the same OS sees two identical
labels — they cannot distinguish them. The session list in
`/account/security` shows `lastUsedAt` and IP-prefix to disambiguate.
Adding a fingerprint hash would help disambiguation but would re-introduce
the privacy concern. Phase 1C ratified the trade-off in favor of privacy.
