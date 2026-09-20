import { Link, useParams } from 'react-router-dom';
import { Empty, Spin, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { versionApi } from '../../api/endpoints';

const OP_LABEL: Record<string, string> = {
  added: '新增',
  removed: '删除',
  modified: '修改',
  moved: '移动',
  unchanged: '未变',
};

const SECTION_LABEL: Record<string, string> = {
  step: '步骤',
  ingredient: '用量',
  spec: '口述结论',
};

/** 版本差异：左右对照 + 每条改动的原因 */
export function DiffPage() {
  const { workspaceId, recipeId, baseId, targetId } = useParams<{
    workspaceId: string;
    recipeId: string;
    baseId: string;
    targetId: string;
  }>();

  const diff = useQuery({
    queryKey: ['diff', targetId, baseId],
    queryFn: () => versionApi.diff(targetId!, baseId),
    enabled: Boolean(targetId && baseId),
  });

  if (diff.isLoading) return <Spin size="large" />;
  if (diff.isError || !diff.data) return <Empty description="无法加载版本差异" />;

  const { entries, summary } = diff.data;

  return (
    <div className="froa-stack">
      <div className="froa-page-title">
        <div>
          <h1>
            版本差异 v{diff.data.baseVersion.versionNo} → v{diff.data.targetVersion.versionNo}
          </h1>
          <div className="froa-hint">
            新增 {summary.added} ｜ 删除 {summary.removed} ｜ 修改 {summary.modified} ｜ 移动 {summary.moved}
          </div>
        </div>
        <Link to={`/w/${workspaceId}/recipes/${recipeId}/versions`}>返回版本列表</Link>
      </div>

      {entries.length === 0 ? (
        <Empty description="两个版本之间没有内容差异" />
      ) : (
        <div className="froa-stack">
          {entries.map((entry, index) => (
            <div key={`${entry.section}-${entry.key}-${index}`} className={`froa-diff-row op-${entry.op}`}>
              <div>
                <span className="froa-diff-badge">{OP_LABEL[entry.op] ?? entry.op}</span>
                <Tag>{SECTION_LABEL[entry.section] ?? entry.section}</Tag>
                <strong>{entry.label}</strong>
              </div>
              <div>
                <div>
                  <Typography.Text type="secondary">改前：</Typography.Text>
                  {entry.before === null || entry.before === undefined || entry.before === ''
                    ? '（无）'
                    : String(entry.before)}
                </div>
                <div>
                  <Typography.Text type="secondary">改后：</Typography.Text>
                  {entry.after === null || entry.after === undefined || entry.after === ''
                    ? '（无）'
                    : String(entry.after)}
                </div>
                {entry.sources?.length ? (
                  <div className="froa-hint">
                    原因：{entry.sources.map((source) => source.label).join('；')}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
