import { prisma } from '../db/client';
import { newId } from '../lib/ids';
import { stringifyJson } from '../lib/json';
import { logger } from '../lib/logger';

export interface ActivityInput {
  workspaceId: string;
  actorId: string;
  /** 形如 'vague_item.resolve'、'version.publish' */
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * 审计日志：只追加，不修改。
 * 日志写入失败不能影响主流程，因此这里吞掉异常并告警。
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        id: newId(),
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        diff: stringifyJson({ before: input.before ?? null, after: input.after ?? null }),
      },
    });
  } catch (error) {
    logger.warn({ err: error, action: input.action }, '审计日志写入失败');
  }
}
