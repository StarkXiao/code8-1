import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env.isProduction ? 'info' : 'debug'),
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino/file',
        options: { destination: 1 },
      },
});
