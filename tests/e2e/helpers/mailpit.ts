/**
 * Mailpit HTTP API helpers for Phase 1B E2E specs.
 *
 * Mailpit is the dev/CI SMTP catcher (docker-compose `mailpit` service, ports
 * 1025 SMTP / 8025 HTTP). The app/worker enqueue mail jobs (BullMQ `mail`
 * queue) and the worker process delivers them via nodemailer to Mailpit.
 *
 * All helpers default to MAILPIT_URL || http://localhost:8025.
 */

const MAILPIT_BASE = (process.env.MAILPIT_URL ?? 'http://localhost:8025').replace(/\/$/, '');

/**
 * Resolve the app's base URL for spec assertions / link extraction.
 * Falls back to `http://localhost:3000` when APP_URL is not set
 * (matches the Playwright dev-server convention used in CI + locally).
 */
export function getAppUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

export interface MailpitMessage {
  ID: string;
  To: { Address: string; Name?: string }[];
  From?: { Address: string; Name?: string };
  Subject: string;
  Snippet: string;
}

interface MailpitListResponse {
  messages: MailpitMessage[];
  total: number;
}

interface MailpitMessageBody {
  HTML: string;
  Text: string;
}

/** Wipe every message from Mailpit. Call from beforeEach. */
export async function clearMailpit(): Promise<void> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/messages`, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Mailpit clear failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Poll Mailpit until a message matching `to` (and optional predicate) appears.
 * Returns the first match. Throws after `timeoutMs` (default 15s).
 *
 * Predicate runs on the list payload (Subject, Snippet, To). For full body
 * matching, call getMessageBody() afterward.
 */
export async function waitForEmail(
  to: string,
  predicate?: (m: MailpitMessage) => boolean,
  timeoutMs = 15_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  const targetLower = to.toLowerCase();
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MAILPIT_BASE}/api/v1/messages?limit=200`);
      if (res.ok) {
        const data = (await res.json()) as MailpitListResponse;
        for (const m of data.messages) {
          const matchesTo = m.To.some((addr) => addr.Address.toLowerCase() === targetLower);
          if (!matchesTo) continue;
          if (!predicate || predicate(m)) return m;
        }
      } else {
        lastError = new Error(`Mailpit GET ${res.status}`);
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `email to ${to} not received in ${timeoutMs}ms` +
      (lastError ? ` (last error: ${String((lastError as Error).message ?? lastError)})` : ''),
  );
}

/** Fetch full HTML+Text body of a message by ID. */
export async function getMessageBody(id: string): Promise<MailpitMessageBody> {
  const res = await fetch(`${MAILPIT_BASE}/api/v1/message/${id}`);
  if (!res.ok) {
    throw new Error(`Mailpit GET message ${id} failed: ${res.status}`);
  }
  const data = (await res.json()) as { HTML: string; Text: string };
  return { HTML: data.HTML ?? '', Text: data.Text ?? '' };
}

/**
 * Extract the first absolute URL starting with `prefix` from `body`.
 * Stops at the first whitespace, quote, `<`, `>`, `]`, or `)` so we ignore
 * trailing HTML markup. Throws if not found.
 */
export function extractFirstUrl(body: string, prefix: string): string {
  const idx = body.indexOf(prefix);
  if (idx < 0) {
    throw new Error(`URL with prefix "${prefix}" not found in body`);
  }
  let end = idx;
  while (end < body.length) {
    const c = body[end];
    if (c === undefined || c === ' ' || c === '\n' || c === '\r' || c === '\t' || c === '"' ||
        c === "'" || c === '<' || c === '>' || c === ']' || c === ')') {
      break;
    }
    end++;
  }
  return body.slice(idx, end);
}
