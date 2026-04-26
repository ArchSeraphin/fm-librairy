import pino from 'pino';
import { getEnv } from './env';

// Configuration de redaction partagée — exportée pour les tests qui veulent
// vérifier que la liste reste alignée avec la production.
export const LOGGER_REDACT = {
  paths: [
    'password',
    'passwordHash',
    'token',
    'tokenHash',
    'secret',
    'secretCipher',
    'authorization',
    '*.password',
    '*.passwordHash',
    '*.token',
    '*.tokenHash',
    '*.secret',
    '*.secretCipher',
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
  ],
  censor: '[REDACTED]',
};

let _logger: pino.Logger | undefined;

export function getLogger(): pino.Logger {
  if (_logger) return _logger;
  const env = getEnv();
  const isDev = env.NODE_ENV === 'development';
  _logger = pino({
    level: env.LOG_LEVEL,
    base: { service: 'biblioshare', env: env.NODE_ENV },
    redact: LOGGER_REDACT,
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(isDev
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:HH:MM:ss',
              ignore: 'pid,hostname,service,env',
            },
          },
        }
      : {}),
  });
  return _logger;
}
