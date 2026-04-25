/**
 * Headers de sécurité globaux.
 * - HSTS : force HTTPS
 * - X-Frame-Options DENY : interdit l'embed (clickjacking)
 * - X-Content-Type-Options nosniff : interdit MIME-sniffing
 * - Referrer-Policy strict-origin-when-cross-origin : limite les fuites
 * - Permissions-Policy : désactive les fonctionnalités sensibles
 * - CSP stricte : whitelist des sources, jamais 'unsafe-inline' sans nonce
 */

export type CspNonce = string;

export function buildCspHeader(nonce: CspNonce, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'", // Tailwind émet des styles inline ; à durcir si possible plus tard
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ];
  return directives.join('; ');
}

export const STATIC_SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
] as const;
