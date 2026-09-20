import { Router } from 'express';
import { createVerificationSchema } from '@froa/shared';
import { prisma } from '../db/client';
import { ApiError, notFound } from '../lib/errors';
import { asyncHandler, created, send } from '../lib/http';
import { newId } from '../lib/ids';
import { stringifyJson } from '../lib/json';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { assertClipInRecipe, assertRecipeRole } from '../services/access';
import { logActivity } from '../services/activity';
import { notify, workspaceMemberIds } from '../services/notify';
import { emitToWorkspace } from '../realtime/hub';
import { toVerificationDto } from '../services/serialize';

export const verificationRouter: Router = Router();

verificationRouter.use(requireAuth);

verificationRouter.get(
  '/recipes/:recipeId/verifications',
  asyncHandler(async (req, res) => {
    const { recipeId } = req.params;
    await assertRecipeRole(req.auth!.userId, recipeId!, 'viewer');

    const runs = await prisma.verificationRun.findMany({
      where: { recipeId: recipeId! },
      include: {
        performer: { select: { id: true, displayName: true, avatarUrl: true } },
        reopenedItems: { select: { id: true } },
      },
      orderBy: { performedAt: 'desc' },
    });

    send(res, runs.map(toVerificationDto));
  }),
);

/**
 * 提交复做验证 —— 这是闭环真正合上的动作。
 *
 * - success: 关联的已规格化条目升级为 verified（终态）；
 * - partial / fail: 必填偏差说明，并自动为每条偏差生成一条新的待澄清条目，
 *   状态回到 open，于是整个流程重新进入整理回路。
 */
verificationRouter.post(
  '/recipes/:recipeId/verifications',
  validateBody(createVerificationSchema),
  asyncHandler(async (req, res) => {
    const { recipeId } = req.params;
    const access = await assertRecipeRole(req.auth!.userId, recipeId!, 'contributor');

    const { versionId, result, deviations, photoUrls, voiceClipId, performedAt } = req.body as {
      versionId: string;
      result: 'success' | 'partial' | 'fail';
      deviations?: string | null;
      photoUrls: string[];
      voiceClipId?: string | null;
      performedAt?: string;
    };

    const version = await prisma.recipeVersion.findUnique({ where: { id: versionId } });
    if (!version || version.recipeId !== recipeId) throw notFound('版本');

    // 复做反馈的录音也必须属于这张食谱，否则会挂上别人家的原声
    if (voiceClipId) await assertClipInRecipe(req.auth!.userId, voiceClipId, recipeId!);

    if (result !== 'success' && !deviations?.trim()) {
      throw new ApiError('DEVIATION_REQUIRED');
    }

    const reopenIds: string[] = [];

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.verificationRun.create({
        data: {
          id: newId(),
          recipeId: recipeId!,
          versionId,
          performedBy: req.auth!.userId,
          performedAt: performedAt ? new Date(performedAt) : new Date(),
          result,
          deviations: deviations ?? null,
          photoUrls: stringifyJson(photoUrls ?? []),
          voiceClipId: voiceClipId ?? null,
        },
      });

      if (result === 'success') {
        await tx.vagueItem.updateMany({
          where: { recipeId: recipeId!, status: 'resolved' },
          data: { status: 'verified' },
        });
      } else {
        // 复做失败/偏差：把偏差拆成新的待澄清条目，重新进入整理回路
        const phrases = (deviations ?? '')
          .split(/[。；;\n]/)
          .map((line) => line.trim())
          .filter((line) => line.length >= 2)
          .slice(0, 10);

        const candidates = phrases.length ? phrases : ['复做结果与食谱描述不一致，需要重新确认'];

        for (const phrase of candidates) {
          const item = await tx.vagueItem.create({
            data: {
              id: newId(),
              recipeId: recipeId!,
              versionId: versionId,
              category: 'other',
              rawPhrase: phrase,
              transcript: `来自 ${new Date().toISOString().slice(0, 10)} 的复做反馈`,
              status: 'open',
              reopenedFromVerificationId: created.id,
              createdBy: req.auth!.userId,
            },
          });
          reopenIds.push(item.id);
        }

        // 已规格化的结论降级：需要重新确认
        await tx.vagueItem.updateMany({
          where: { recipeId: recipeId!, status: 'resolved' },
          data: { confidence: 'assumed' },
        });
      }

      return created;
    });

    await logActivity({
      workspaceId: access.workspaceId,
      actorId: req.auth!.userId,
      action: 'verification.create',
      entityType: 'vague_item',
      entityId: reopenIds[0] ?? run.id,
      after: { result, deviations: deviations ?? null, reopenedItemIds: reopenIds },
    });

    const members = await workspaceMemberIds(access.workspaceId);
    await notify({
      userIds: members,
      // 复做成功有自己的通知类型：用 'published' 会显示成"版本动态"，语义不对
      type: result === 'success' ? 'verification_passed' : 'verification_failed',
      excludeUserId: req.auth!.userId,
      payload: {
        recipeId: recipeId!,
        versionId,
        verificationId: run.id,
        result,
        reopenedItemIds: reopenIds,
        message:
          result === 'success'
            ? `v${version.versionNo} 复做成功，结论已标记为"已验证"`
            : `v${version.versionNo} 复做出现偏差，已新增 ${reopenIds.length} 条待澄清条目`,
      },
    });

    emitToWorkspace(access.workspaceId, 'verification:submitted', {
      recipeId: recipeId!,
      verificationId: run.id,
      result,
      reopenedItemIds: reopenIds,
    });

    created(res, { ...toVerificationDto({ ...run, reopenedItems: reopenIds.map((id) => ({ id })) }), reopenedItemIds: reopenIds });
  }),
);
