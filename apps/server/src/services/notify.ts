import type { NotificationType } from '@froa/shared';
import { prisma } from '../db/client';
import { newId } from '../lib/ids';
import { stringifyJson } from '../lib/json';
import { logger } from '../lib/logger';
import { emitToUser } from '../realtime/hub';

export interface NotifyInput {
  userIds: string[];
  type: NotificationType;
  payload: Record<string, unknown>;
  /** 排除操作者本人，避免自己给自己发通知 */
  excludeUserId?: string;
}

/**
 * 写通知 + 实时推送。
 * 会自动去重（同一次调用内）并排除触发者自身。
 */
export async function notify({ userIds, type, payload, excludeUserId }: NotifyInput): Promise<void> {
  const targets = [...new Set(userIds)].filter((id) => id && id !== excludeUserId);
  if (!targets.length) return;

  const serialized = stringifyJson(payload);
  const rows = targets.map((userId) => ({
    id: newId(),
    userId,
    type,
    payload: serialized,
  }));

  try {
    await prisma.notification.createMany({ data: rows });
  } catch (error) {
    logger.warn({ err: error, type }, '通知写入失败');
    return;
  }

  for (const row of rows) {
    emitToUser(row.userId, 'notification:new', {
      id: row.id,
      type,
      payload,
      createdAt: new Date().toISOString(),
    });
  }
}

/** 空间内除某人之外的全部成员 id */
export async function workspaceMemberIds(workspaceId: string): Promise<string[]> {
  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}
