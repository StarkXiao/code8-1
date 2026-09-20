import type { Server as SocketServer } from 'socket.io';
import { logger } from '../lib/logger';

/**
 * 实时事件总线。
 *
 * 单独抽出来是为了让业务层不必持有 socket 实例：
 * 测试环境没有 WebSocket 时，这里静默降级，业务逻辑照常工作。
 */
let io: SocketServer | null = null;

export function attachSocketServer(server: SocketServer | null): void {
  io = server;
}

export function workspaceRoom(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export function emitToWorkspace(workspaceId: string, event: string, payload: unknown): void {
  if (!io) return;
  try {
    io.to(workspaceRoom(workspaceId)).emit(event, payload);
  } catch (error) {
    logger.warn({ err: error, event }, '实时事件广播失败');
  }
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  if (!io) return;
  try {
    io.to(`user:${userId}`).emit(event, payload);
  } catch (error) {
    logger.warn({ err: error, event }, '实时事件广播失败');
  }
}

export function isRealtimeEnabled(): boolean {
  return io !== null;
}
