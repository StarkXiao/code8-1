import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ApiError } from '../lib/errors';
import { logger } from '../lib/logger';

/** 404 兜底：交给统一错误响应 */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: {
      code: 'RESOURCE_NOT_FOUND',
      message: `接口不存在：${req.method} ${req.path}`,
    },
  });
}

/** 统一错误响应：{ error: { code, message, details } } */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = (req as Request & { id?: string }).id;

  if (error instanceof ApiError) {
    if (error.status >= 500) {
      logger.error({ err: error, requestId, path: req.path }, 'api error (5xx)');
    } else {
      logger.debug({ code: error.code, requestId, path: req.path }, 'api error');
    }
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
  }

  if (error instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_FAILED',
        message: '提交的数据不合法',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  /**
   * Prisma 的常见错误翻译成业务错误码。
   *
   * 不做这一步的话，"改一个不存在的成员""删一条已被删掉的用量"这类操作
   * 都会冒成 500，前端只能显示"服务器内部错误"，排查成本很高。
   */
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        error: { code: 'RESOURCE_NOT_FOUND', message: '记录不存在或已被删除' },
      });
    }
    if (error.code === 'P2002') {
      return res.status(409).json({
        error: { code: 'EDIT_CONFLICT', message: '存在重复记录，请刷新后重试' },
      });
    }
    if (error.code === 'P2003') {
      return res.status(400).json({
        error: { code: 'VALIDATION_FAILED', message: '关联的数据不存在或已被删除' },
      });
    }
    logger.error({ err: error, requestId, path: req.path }, 'prisma error');
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: '数据库操作失败' },
    });
  }

  const message = error instanceof Error ? error.message : String(error);
  logger.error({ err: error, requestId, path: req.path }, 'unhandled error');

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production' ? '服务器内部错误' : message,
    },
  });
}
