import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from '../lib/errors';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  typ: 'access' | 'refresh';
}

export function signAccessToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email, typ: 'access' } satisfies AccessTokenPayload, env.jwtSecret, {
    expiresIn: env.accessTokenTtl,
  } as jwt.SignOptions);
}

export function signRefreshToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email, typ: 'refresh' } satisfies AccessTokenPayload, env.jwtSecret, {
    expiresIn: env.refreshTokenTtl,
  } as jwt.SignOptions);
}

export function verifyToken(token: string, expected: 'access' | 'refresh'): AccessTokenPayload {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.jwtSecret);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) throw new ApiError('AUTH_TOKEN_EXPIRED');
    throw new ApiError('AUTH_TOKEN_INVALID');
  }
  const payload = decoded as AccessTokenPayload;
  if (!payload?.sub || payload.typ !== expected) throw new ApiError('AUTH_TOKEN_INVALID');
  return payload;
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  // 音频 <audio> 标签无法自定义请求头，允许通过查询参数传入（见 audio.stream）
  const queryToken = req.query.access_token;
  if (typeof queryToken === 'string' && queryToken) return queryToken;
  return null;
}

/** 要求已登录 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractBearer(req);
  if (!token) return next(new ApiError('AUTH_MISSING_TOKEN'));
  try {
    const payload = verifyToken(token, 'access');
    req.auth = { userId: payload.sub, email: payload.email };
    return next();
  } catch (error) {
    return next(error);
  }
}

/** 令牌有效期（秒），供前端展示 */
export function accessTokenSeconds(): number {
  const ttl = env.accessTokenTtl;
  const match = /^(\d+)([smhd])?$/.exec(ttl);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * factor;
}
