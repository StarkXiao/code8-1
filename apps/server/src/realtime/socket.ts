import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { verifyToken } from '../middleware/auth';
import { prisma } from '../db/client';
import { attachSocketServer, workspaceRoom } from './hub';

/**
 * Socket.IO 网关。
 * 握手时校验 access token，并按用户所在的家庭空间自动加入房间。
 */
export function createSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    path: '/ws',
    cors: { origin: [env.webOrigin], credentials: true },
    serveClient: false,
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (typeof socket.handshake.query.access_token === 'string' ? socket.handshake.query.access_token : undefined);
      if (!token) return next(new Error('AUTH_MISSING_TOKEN'));
      const payload = verifyToken(token, 'access');
      socket.data.userId = payload.sub;
      return next();
    } catch {
      return next(new Error('AUTH_TOKEN_INVALID'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    socket.join(`user:${userId}`);

    try {
      const memberships = await prisma.workspaceMember.findMany({
        where: { userId },
        select: { workspaceId: true },
      });
      for (const membership of memberships) socket.join(workspaceRoom(membership.workspaceId));
    } catch (error) {
      logger.warn({ err: error, userId }, '加入空间房间失败');
    }

    socket.on('presence:join', (payload: { workspaceId?: string; recipeId?: string }) => {
      if (!payload?.workspaceId) return;
      socket.to(workspaceRoom(payload.workspaceId)).emit('presence:join', {
        userId,
        recipeId: payload.recipeId ?? null,
      });
    });

    socket.on('presence:leave', (payload: { workspaceId?: string; recipeId?: string }) => {
      if (!payload?.workspaceId) return;
      socket.to(workspaceRoom(payload.workspaceId)).emit('presence:leave', {
        userId,
        recipeId: payload.recipeId ?? null,
      });
    });

    socket.on('disconnect', () => {
      // 无需额外处理：房间成员关系由 socket.io 自动清理
    });
  });

  attachSocketServer(io);
  return io;
}
