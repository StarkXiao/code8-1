import { Router } from 'express';
import { readNotificationsSchema } from '@froa/shared';
import { prisma } from '../db/client';
import { asyncHandler, parsePaging, send, sendList } from '../lib/http';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import { toNotificationDto } from '../services/serialize';

export const notificationRouter: Router = Router();

notificationRouter.use(requireAuth);

notificationRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const unreadOnly = req.query.unread === 'true';
    const { skip, take, page, pageSize } = parsePaging(req, 30);
    const where = {
      userId: req.auth!.userId,
      ...(unreadOnly ? { readAt: null } : {}),
    };

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: req.auth!.userId, readAt: null } }),
    ]);

    sendList(res, items.map(toNotificationDto), { total, page, pageSize, unreadCount });
  }),
);

notificationRouter.post(
  '/notifications/read',
  validateBody(readNotificationsSchema),
  asyncHandler(async (req, res) => {
    const { ids, all } = req.body as { ids?: string[]; all?: boolean };

    const result = await prisma.notification.updateMany({
      where: {
        userId: req.auth!.userId,
        readAt: null,
        ...(all ? {} : { id: { in: ids ?? [] } }),
      },
      data: { readAt: new Date() },
    });

    send(res, { updated: result.count });
  }),
);
