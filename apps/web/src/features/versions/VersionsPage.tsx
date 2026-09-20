import { Link, useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Empty, Space, Spin, Table, Tag, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VERSION_STATUS_LABELS, type RecipeVersionDto } from '@froa/shared';
import { recipeApi, versionApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';

const STATUS_COLOR: Record<string, string> = {
  draft: 'gold',
  in_review: 'blue',
  published: 'green',
  archived: 'default',
};

export function VersionsPage() {
  const { workspaceId, recipeId } = useParams<{ workspaceId: string; recipeId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const recipe = useQuery({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipeApi.get(recipeId!),
    enabled: Boolean(recipeId),
  });

  const versions = useQuery({
    queryKey: ['versions', recipeId],
    queryFn: () => versionApi.list(recipeId!),
    enabled: Boolean(recipeId),
  });

  const forkMutation = useMutation({
    mutationFn: (fromVersionId?: string) => versionApi.fork(recipeId!, { fromVersionId }),
    onSuccess: () => {
      message.success('已创建新草稿');
      void queryClient.invalidateQueries({ queryKey: ['versions', recipeId] });
      void queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  if (versions.isLoading) return <Spin size="large" />;

  const list = versions.data ?? [];
  const hasDraft = list.some((version) => version.status === 'draft');
  const canEdit = recipe.data?.myRole === 'owner' || recipe.data?.myRole === 'editor';

  return (
    <div className="froa-stack">
      <div className="froa-page-title">
        <div>
          <h1>版本历史 · {recipe.data?.title}</h1>
          <div className="froa-hint">
            已发布的版本不可修改。要改就先派生新草稿，改动会记在版本差异里。
          </div>
        </div>
        <Space wrap>
          <Button
            type="primary"
            disabled={hasDraft || !canEdit}
            loading={forkMutation.isPending}
            onClick={() => forkMutation.mutate(undefined)}
          >
            新建草稿
          </Button>
          <Link to={`/w/${workspaceId}/recipes/${recipeId}`}>
            <Button>返回食谱</Button>
          </Link>
        </Space>
      </div>

      {!hasDraft && canEdit && (
        <Typography.Text type="secondary">
          当前没有草稿，可以随时基于最新版本新建一版。
        </Typography.Text>
      )}

      {list.length === 0 ? (
        <Empty description="还没有任何版本" />
      ) : (
        <Table<RecipeVersionDto & { counts: { steps: number; ingredients: number; verifications: number } }>
          rowKey="id"
          dataSource={list}
          pagination={false}
          columns={[
            {
              title: '版本',
              dataIndex: 'versionNo',
              render: (versionNo: number, record) => (
                <Space>
                  <strong>v{versionNo}</strong>
                  <Tag color={STATUS_COLOR[record.status]}>{VERSION_STATUS_LABELS[record.status]}</Tag>
                </Space>
              ),
            },
            { title: '标题', dataIndex: 'title' },
            {
              title: '内容',
              render: (_, record) => `${record.counts.steps} 步 ｜ ${record.counts.ingredients} 项用量`,
            },
            {
              title: '复做验证',
              render: (_, record) => (record.counts.verifications ? `${record.counts.verifications} 次` : '—'),
            },
            {
              title: '发布时间',
              dataIndex: 'publishedAt',
              render: (value: string | null) => (value ? value.slice(0, 16).replace('T', ' ') : '—'),
            },
            {
              title: '变更说明',
              dataIndex: 'changeNote',
              render: (value: string | null) =>
                value ? (
                  <Typography.Text style={{ fontSize: '0.85rem' }} ellipsis={{ tooltip: value }}>
                    {value.slice(0, 30)}
                  </Typography.Text>
                ) : (
                  '—'
                ),
            },
            {
              title: '',
              render: (_, record) => (
                <Space>
                  {record.parentVersionId && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() =>
                        navigate(
                          `/w/${workspaceId}/recipes/${recipeId}/versions/${record.parentVersionId}/diff/${record.id}`,
                        )
                      }
                    >
                      对比上一版
                    </Button>
                  )}
                  {canEdit && !hasDraft && (
                    <Button
                      size="small"
                      type="link"
                      onClick={() => forkMutation.mutate(record.id)}
                    >
                      基于此版新建草稿
                    </Button>
                  )}
                  <a href={versionApi.exportUrl(record.id, 'md')} target="_blank" rel="noreferrer">
                    <Button size="small" type="link">
                      导出
                    </Button>
                  </a>
                </Space>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
