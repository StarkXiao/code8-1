import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { loginSchema, refreshSchema, registerSchema, updateMeSchema } from '@froa/shared';
import { prisma } from '../db/client';
import { ApiError, notFound } from '../lib/errors';
import { asyncHandler, created, send } from '../lib/http';
import { newId } from '../lib/ids';
import {
  accessTokenSeconds,
  requireAuth,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { toUserDto } from '../services/serialize';

export const authRouter: Router = Router();

const BCRYPT_ROUNDS = 12;

function issueTokens(userId: string, email: string) {
  return {
    accessToken: signAccessToken(userId, email),
    refreshToken: signRefreshToken(userId, email),
    expiresIn: accessTokenSeconds(),
  };
}

authRouter.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, displayName } = req.body as {
      email: string;
      password: string;
      displayName: string;
    };

    // 先查一次是为了给出友好提示；真正防重复靠唯一索引 ——
    // 两个请求同时通过"查无此人"时，只有一个能插入成功，另一个会拿到 P2002。
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ApiError('AUTH_EMAIL_TAKEN');

    let user;
    try {
      user = await prisma.user.create({
        data: {
          id: newId(),
          email,
          displayName,
          passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApiError('AUTH_EMAIL_TAKEN');
      }
      throw error;
    }

    created(res, { user: toUserDto(user), tokens: issueTokens(user.id, user.email) });
  }),
);

authRouter.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string };

    const user = await prisma.user.findUnique({ where: { email } });
    // 无论用户是否存在都返回同一个错误，避免邮箱枚举
    if (!user) throw new ApiError('AUTH_INVALID_CREDENTIALS');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new ApiError('AUTH_INVALID_CREDENTIALS');

    send(res, { user: toUserDto(user), tokens: issueTokens(user.id, user.email) });
  }),
);

authRouter.post(
  '/refresh',
  validateBody(refreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as { refreshToken: string };
    const payload = verifyToken(refreshToken, 'refresh');

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new ApiError('AUTH_TOKEN_INVALID');

    send(res, { tokens: issueTokens(user.id, user.email) });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw notFound('用户');
    send(res, toUserDto(user));
  }),
);

authRouter.patch(
  '/me',
  requireAuth,
  validateBody(updateMeSchema),
  asyncHandler(async (req, res) => {
    const { displayName, avatarUrl } = req.body as {
      displayName?: string;
      avatarUrl?: string | null;
    };

    const user = await prisma.user.update({
      where: { id: req.auth!.userId },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      },
    });

    send(res, toUserDto(user));
  }),
);
