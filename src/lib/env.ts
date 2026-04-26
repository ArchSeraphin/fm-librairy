import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Base URL de l'app (utilisée pour les liens d'invitation, magic links, etc.)
  APP_URL: z.string().url(),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Meilisearch
  MEILI_HOST: z.string().url(),
  MEILI_MASTER_KEY: z.string().min(16),

  // ClamAV
  CLAMAV_HOST: z.string().default('clamav'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

  // Logger
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Sécurité (utilisés en Phase 1+ ; définis dès Phase 0 pour valider le contrat)
  SESSION_SECRET: z.string().min(32),
  CRYPTO_MASTER_KEY: z.string().min(32),

  // Sels rotatifs pour hash IP/UA (mitigation H2 RGPD). Statiques en Phase 1A,
  // rotation = Phase 8.
  IP_HASH_SALT: z.string().min(16),
  UA_HASH_SALT: z.string().min(16),

  // Email (Phase 1+)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().email().default('noreply@biblioshare.local'),

  // APIs métadonnées (Phase 2+)
  GOOGLE_BOOKS_API_KEY: z.string().optional(),
  ISBNDB_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "[env] Variables d'environnement invalides :",
      parsed.error.flatten().fieldErrors,
    );
    throw new Error('Invalid environment variables');
  }
  cached = parsed.data;
  return cached;
}
