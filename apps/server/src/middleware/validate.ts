import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ApiError } from '../lib/errors';

function toDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** 校验并**替换** req.body，后续代码拿到的永远是干净数据 */
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new ApiError('VALIDATION_FAILED', '提交的数据不合法', toDetails(result.error)));
    }
    req.body = result.data;
    return next();
  };
}

export function validateQuery<T extends ZodTypeAny>(schema: T): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(new ApiError('VALIDATION_FAILED', '查询参数不合法', toDetails(result.error)));
    }
    // 关键：把解析结果**写回 req.query**。
    // 只写 req.validatedQuery 的话，路由里 `req.query.includeDeleted` 拿到的仍是原始字符串，
    // 类型转换和默认值全部失效 —— 这类"校验过了但没生效"的 bug 很难被发现。
    Object.defineProperty(req, 'query', {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    Object.defineProperty(req, 'validatedQuery', {
      value: result.data,
      writable: true,
      configurable: true,
    });
    return next();
  };
}

/** 读取 validateQuery 写回的结果 */
export function queryOf<T extends ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  const direct = (req as unknown as { validatedQuery?: unknown }).validatedQuery;
  if (direct !== undefined) return direct as z.infer<T>;
  return schema.parse(req.query) as z.infer<T>;
}
