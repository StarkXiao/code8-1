import { ApiError } from './errors';

/**
 * 乐观锁守卫。
 *
 * 场景：两个人同时打开同一条待澄清条目，甲先改完保存，乙基于旧内容再保存 ——
 * 如果不检查，乙的提交会静默覆盖甲。这里要求客户端在提交时回传它读到数据时的
 * updatedAt；不一致就返回 409 并附上服务端当前值，让前端提示"别人改过了，刷新看看"。
 *
 * 客户端不传 expectedUpdatedAt 时退化为"最后写入者胜"，保证老客户端仍能工作。
 */
export function assertNotStale(
  current: Date,
  expected: string | undefined,
  payload: Record<string, unknown> = {},
): void {
  if (!expected) return;
  if (current.getTime() === new Date(expected).getTime()) return;

  throw new ApiError('EDIT_CONFLICT', '内容已被他人修改，请刷新后重试', {
    currentUpdatedAt: current.toISOString(),
    expectedUpdatedAt: expected,
    ...payload,
  });
}
