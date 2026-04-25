import pino from 'pino';
import { getEnv } from './env';

const env = getEnv();

const isDev = env.NODE_ENV === 'development';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'biblioshare', env: env.NODE_ENV },
  redact: {
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
  },
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
