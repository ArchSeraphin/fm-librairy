import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns `candidate` if it is a same-origin path (starts with "/" and not "//"),
 * otherwise returns `fallback`. Defends against open-redirect via attacker-controlled
 * `callbackUrl` query params consumed by client-side navigation primitives.
 */
export function safeCallbackUrl(candidate: string | null | undefined, fallback: string): string {
  if (!candidate) return fallback;
  // Reject protocol-relative URLs (`//evil.tld/...`) and absolute URLs (`https://evil.tld/...`)
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return fallback;
  return candidate;
}
