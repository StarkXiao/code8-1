import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../lib/errors';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * 极简固定窗口限流。
 *
 * 目的是挡住对登录/注册的口令爆破，而不是做完整的网关限流，
 * 因此刻意不引入额外依赖：单进程内存计数即可。
 *
 * 多实例部署时每个实例各自计数，效果会打折；那种规模下应该换成 Redis 计数。
 */
export function rateLimit(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
}): RequestHandler {
  const buckets = new Map<string, Bucket>();

  // 定期清理过期桶，避免内存无限增长
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(options.windowMs, 60_000));
  cleanup.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${options.keyPrefix}:${ip}`;
    const now = Date.now();

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      res.setHeader('X-RateLimit-Limit', options.max);
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);
      next(
        new ApiError(
          'RATE_LIMITED',
          `操作过于频繁，请 ${retryAfterSeconds} 秒后再试`,
        ),
      );
      return;
    }

    next();
  };
}
