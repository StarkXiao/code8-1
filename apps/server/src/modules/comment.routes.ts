import { Router } from 'express';
import { createCommentSchema, type CommentTargetType, type WorkspaceRole } from '@froa/shared';
import { prisma } from '../db/client';
import { ApiError, notFound } from '../lib/errors';
import { asyncHandler, created, parsePaging, send, sendList } from '../lib/http';
import { newId } from '../lib/ids';
import { stringifyJson } from '../lib/json';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import {
  assertRecipeRole,
  assertStepRole,
  assertUsersInWorkspace,
  assertVagueItemRole,
  assertVersionRole,
} from '../services/access';
import { logActivity } from '../services/activity';
import { notify } from '../services/notify';
import { emitToWorkspace } from '../realtime/hub';
import { toCommentDto } from '../services/serialize';

export const commentRouter: Router = Router();

commentRouter.use(requireAuth);

/** 按 target 类型解析它所属的空间与食谱，用于鉴权 */
async function resolveTargetContext(
  userId: string,
  targetType: CommentTargetType,
  targetId: string,
  required: WorkspaceRole = 'viewer',
): Promise<{ workspaceId: string; recipeId: string }> {
  switch (targetType) {
    case 'recipe': {
      const access = await assertRecipeRole(userId, targetId, required);
      return { workspaceId: access.workspaceId, recipeId: access.recipeId };
    }
    case 'version': {
      const access = await assertVersionRole(userId, targetId, required);
      return { workspaceId: access.workspaceId, recipeId: access.recipeId };
    }
    case 'step': {
      const access = await assertStepRole(userId, targetId, required);
      return { workspaceId: access.workspaceId, recipeId: access.recipeId };
    }
    case 'vague_item': {
      const access = await assertVagueItemRole(userId, targetId, required);
      return { workspaceId: access.workspaceId, recipeId: access.recipeId };
    }
    case 'verification': {
      const run = await prisma.verificationRun.findUnique({
        where: { id: targetId },
        select: { recipeId: true },
      });
      if (!run) throw notFound('复做验证');
      const access = await assertRecipeRole(userId, run.recipeId, required);
      return { workspaceId: access.workspaceId, recipeId: access.recipeId };
    }
    default:
      throw new ApiError('VALIDATION_FAILED', '不支持的评论目标类型');
  }
}

commentRouter.get(
  '/comments',
  asyncHandler(async (req, res) => {
    const targetType = String(req.query.targetType ?? '') as CommentTargetType;
    const targetId = String(req.query.targetId ?? '');
    if (!targetType || !targetId) {
      throw new ApiError('VALIDATION_FAILED', '必须提供 targetType 与 targetId');
    }

    await resolveTargetContext(req.auth!.userId, targetType, targetId);
    const { skip, take, page, pageSize } = parsePaging(req, 100);

    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        where: { targetType, targetId },
        include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
        orderBy: { createdAt: 'asc' },
        skip,
        take,
      }),
      prisma.comment.count({ where: { targetType, targetId } }),
    ]);

    sendList(res, comments.map(toCommentDto), { total, page, pageSize });
  }),
);

commentRouter.post(
  '/comments',
  validateBody(createCommentSchema),
  asyncHandler(async (req, res) => {
    const { targetType, targetId, parentId, body, mentions } = req.body as {
      targetType: CommentTargetType;
      targetId: string;
      parentId?: string | null;
      body: string;
      mentions: string[];
    };

    const context = await resolveTargetContext(req.auth!.userId, targetType, targetId);

    // 被 @ 的人必须确实是这个空间的成员，否则通知会把菜谱内容推给外人
    if (mentions?.length) {
      await assertUsersInWorkspace(context.workspaceId, mentions);
    }

    if (parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: parentId } });
      if (!parent || parent.targetId !== targetId) throw notFound('被回复的评论');
    }

    const comment = await prisma.comment.create({
      data: {
        id: newId(),
        targetType,
        targetId,
        authorId: req.auth!.userId,
        parentId: parentId ?? null,
        body,
        mentions: stringifyJson(mentions ?? []),
      },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
    });

    await logActivity({
      workspaceId: context.workspaceId,
      actorId: req.auth!.userId,
      action: 'comment.create',
      entityType: targetType,
      entityId: targetId,
      after: { commentId: comment.id },
    });

    if (mentions?.length) {
      await notify({
        userIds: mentions,
        type: 'mentioned',
        excludeUserId: req.auth!.userId,
        payload: {
          recipeId: context.recipeId,
          targetType,
          targetId,
          commentId: comment.id,
          message: `${comment.author.displayName} 在评论里提到了你：${body.slice(0, 60)}`,
        },
      });
    }

    emitToWorkspace(context.workspaceId, 'comment:created', toCommentDto(comment));
    created(res, toCommentDto(comment));
  }),
);

commentRouter.patch(
  '/comments/:commentId/resolve',
  asyncHandler(async (req, res) => {
    const { commentId } = req.params;
    const comment = await prisma.comment.findUnique({ where: { id: commentId! } });
    if (!comment) throw notFound('评论');

    // 标记"已解决"是协作动作，贡献者及以上都可以做；旁观者不行
    await resolveTargetContext(
      req.auth!.userId,
      comment.targetType as CommentTargetType,
      comment.targetId,
      'contributor',
    );

    const updated = await prisma.comment.update({
      where: { id: commentId! },
      data: { resolvedAt: new Date() },
      include: { author: { select: { id: true, displayName: true, avatarUrl: true } } },
    });

    send(res, toCommentDto(updated));
  }),
);
