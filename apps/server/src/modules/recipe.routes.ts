import { Router } from 'express';
import { createRecipeSchema, updateRecipeSchema, type RecipeCounters, type WorkspaceRole } from '@froa/shared';
import { prisma } from '../db/client';
import { notFound } from '../lib/errors';
import { asyncHandler, created, send, sendList } from '../lib/http';
import { newId } from '../lib/ids';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { assertRecipeRole, assertWorkspaceRole, getMembership } from '../services/access';
import { logActivity } from '../services/activity';
import { toRecipeDto } from '../services/serialize';

export const recipeRouter: Router = Router();

recipeRouter.use(requireAuth);

/* ------------------------------------------------------------------ */
/* 待办计数：首页角标与"今天该干什么"的数据源                          */
/* ------------------------------------------------------------------ */

const EMPTY_COUNTERS: RecipeCounters = {
  openVagueItems: 0,
  askedVagueItems: 0,
  answeredVagueItems: 0,
  resolvedVagueItems: 0,
  verifiedVagueItems: 0,
  unresolvableVagueItems: 0,
  audioCount: 0,
  pendingTranscriptCount: 0,
  hasDraft: false,
  publishedVersionNo: null,
};

export async function buildCounters(recipeIds: string[]): Promise<Map<string, RecipeCounters>> {
  const result = new Map<string, RecipeCounters>();
  for (const id of recipeIds) result.set(id, { ...EMPTY_COUNTERS });
  if (!recipeIds.length) return result;

  const [statusGroups, transcriptGroups, versions] = await Promise.all([
    prisma.vagueItem.groupBy({
      by: ['recipeId', 'status'],
      where: { recipeId: { in: recipeIds } },
      _count: { _all: true },
    }),
    prisma.audioAttachment.groupBy({
      by: ['recipeId', 'transcriptStatus'],
      where: { recipeId: { in: recipeIds }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.recipeVersion.findMany({
      where: { recipeId: { in: recipeIds } },
      select: { recipeId: true, status: true, versionNo: true },
    }),
  ]);

  for (const group of statusGroups) {
    const counters = result.get(group.recipeId);
    if (!counters) continue;
    const count = group._count._all;
    switch (group.status) {
      case 'open':
        counters.openVagueItems += count;
        break;
      case 'asked':
        counters.askedVagueItems += count;
        break;
      case 'answered':
        counters.answeredVagueItems += count;
        break;
      case 'resolved':
        counters.resolvedVagueItems += count;
        break;
      case 'verified':
        counters.verifiedVagueItems += count;
        break;
      case 'unresolvable':
        counters.unresolvableVagueItems += count;
        break;
      default:
        break;
    }
  }

  for (const group of transcriptGroups) {
    const counters = result.get(group.recipeId);
    if (!counters) continue;
    counters.audioCount += group._count._all;
    if (group.transcriptStatus === 'none' || group.transcriptStatus === 'pending') {
      counters.pendingTranscriptCount += group._count._all;
    }
  }

  for (const version of versions) {
    const counters = result.get(version.recipeId);
    if (!counters) continue;
    if (version.status === 'draft') counters.hasDraft = true;
    if (version.status === 'published') {
      counters.publishedVersionNo = Math.max(counters.publishedVersionNo ?? 0, version.versionNo);
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* 食谱列表与创建                                                      */
/* ------------------------------------------------------------------ */

recipeRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const workspaceId = String(req.query.workspaceId ?? '');
    if (!workspaceId) throw notFound('家庭空间');
    await getMembership(req.auth!.userId, workspaceId);

    const status = typeof req.query.status === 'string' ? req.query.status : 'active';
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';

    const recipes = await prisma.recipe.findMany({
      where: {
        workspaceId,
        ...(status === 'all' ? {} : { status }),
        ...(search ? { title: { contains: search } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
    });

    const counters = await buildCounters(recipes.map((recipe) => recipe.id));

    sendList(
      res,
      recipes.map((recipe) => ({ ...toRecipeDto(recipe), counters: counters.get(recipe.id) })),
      { total: recipes.length, page: 1, pageSize: recipes.length },
    );
  }),
);

recipeRouter.post(
  '/',
  validateBody(createRecipeSchema),
  asyncHandler(async (req, res) => {
    const { title, dishCategory, coverUrl } = req.body as {
      title: string;
      dishCategory?: string | null;
      coverUrl?: string | null;
    };
    const workspaceId = String(
      req.query.workspaceId ?? (req.body as { workspaceId?: string }).workspaceId ?? '',
    );
    if (!workspaceId) throw notFound('家庭空间');

    const membership = await assertWorkspaceRole(req.auth!.userId, workspaceId, 'editor');

    // 创建食谱时自动生成 v1 草稿，保证"新建后立刻能录能写"，不留空状态
    const recipe = await prisma.$transaction(async (tx) => {
      const createdRecipe = await tx.recipe.create({
        data: {
          id: newId(),
          workspaceId,
          title,
          dishCategory: dishCategory ?? null,
          coverUrl: coverUrl ?? null,
          createdBy: req.auth!.userId,
        },
      });

      await tx.recipeVersion.create({
        data: {
          id: newId(),
          recipeId: createdRecipe.id,
          versionNo: 1,
          status: 'draft',
          title,
          createdBy: req.auth!.userId,
        },
      });

      return createdRecipe;
    });

    await logActivity({
      workspaceId,
      actorId: req.auth!.userId,
      action: 'recipe.create',
      entityType: 'recipe',
      entityId: recipe.id,
      after: { title },
    });

    void membership;
    created(res, { ...toRecipeDto(recipe), counters: { ...EMPTY_COUNTERS, hasDraft: true } });
  }),
);

recipeRouter.get(
  '/:recipeId',
  asyncHandler(async (req, res) => {
    const { recipeId } = req.params;
    const access = await assertRecipeRole(req.auth!.userId, recipeId!, 'viewer');

    const recipe = await prisma.recipe.findUnique({ where: { id: recipeId! } });
    if (!recipe) throw notFound('食谱');

    const counters = await buildCounters([recipe.id]);
    const versions = await prisma.recipeVersion.findMany({
      where: { recipeId: recipe.id },
      orderBy: { versionNo: 'desc' },
      select: { id: true, versionNo: true, status: true, title: true, publishedAt: true },
    });

    send(res, {
      ...toRecipeDto(recipe),
      counters: counters.get(recipe.id),
      myRole: access.role as WorkspaceRole,
      versions,
    });
  }),
);

recipeRouter.patch(
  '/:recipeId',
  validateBody(updateRecipeSchema),
  asyncHandler(async (req, res) => {
    const { recipeId } = req.params;
    await assertRecipeRole(req.auth!.userId, recipeId!, 'editor');

    const before = await prisma.recipe.findUnique({ where: { id: recipeId! } });
    if (!before) throw notFound('食谱');

    const { title, dishCategory, coverUrl } = req.body as {
      title?: string;
      dishCategory?: string | null;
      coverUrl?: string | null;
    };

    const recipe = await prisma.recipe.update({
      where: { id: recipeId! },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(dishCategory !== undefined ? { dishCategory } : {}),
        ...(coverUrl !== undefined ? { coverUrl } : {}),
      },
    });

    await logActivity({
      workspaceId: before.workspaceId,
      actorId: req.auth!.userId,
      action: 'recipe.update',
      entityType: 'recipe',
      entityId: recipe.id,
      before: { title: before.title, dishCategory: before.dishCategory },
      after: { title: recipe.title, dishCategory: recipe.dishCategory },
    });

    send(res, toRecipeDto(recipe));
  }),
);

recipeRouter.post(
  '/:recipeId/archive',
  asyncHandler(async (req, res) => {
    const { recipeId } = req.params;
    const access = await assertRecipeRole(req.auth!.userId, recipeId!, 'editor');

    const recipe = await prisma.recipe.update({
      where: { id: recipeId! },
      data: { status: 'archived' },
    });

    await logActivity({
      workspaceId: access.workspaceId,
      actorId: req.auth!.userId,
      action: 'recipe.archive',
      entityType: 'recipe',
      entityId: recipe.id,
    });

    send(res, toRecipeDto(recipe));
  }),
);
