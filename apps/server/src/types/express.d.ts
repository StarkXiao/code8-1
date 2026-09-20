import type { WorkspaceRole } from '@froa/shared';

declare global {
  namespace Express {
    interface Request {
      /** 由 requireAuth 注入 */
      auth?: {
        userId: string;
        email: string;
      };
      /** 由 requireWorkspaceAccess 注入，避免下游重复查询 */
      workspace?: {
        id: string;
        role: WorkspaceRole;
        ownerId: string;
        name: string;
      };
    }
  }
}

export {};
