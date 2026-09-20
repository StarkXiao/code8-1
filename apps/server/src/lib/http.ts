import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiListMeta } from '@froa/shared';

/** 把 async 路由处理函数的 rejection 转发给错误中间件 */
export function asyncHandler<T extends RequestHandler>(handler: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function send<T>(res: Response, data: T, meta?: ApiListMeta | Record<string, unknown>) {
  res.json(meta ? { data, meta } : { data });
}

export function sendList<T>(res: Response, data: T[], meta: ApiListMeta | Record<string, unknown>) {
  res.json({ data, meta });
}

export function created<T>(res: Response, data: T) {
  res.status(201).json({ data });
}

/** 分页参数统一解析 */
export function parsePaging(req: Request, defaultPageSize = 50, maxPageSize = 200) {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const rawSize = Number.parseInt(String(req.query.pageSize ?? defaultPageSize), 10);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.isFinite(rawSize) ? rawSize : defaultPageSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;
