import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { App as AntApp, Button, Empty, Form, Input, Modal, Spin, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecipeDto } from '@froa/shared';
import { recipeApi, workspaceApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';

/** 空间首页：食谱网格 + 每个食谱的"今天该干什么"待办角标 */
export function WorkspaceHomePage() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ title: string; dishCategory?: string }>();

  const workspace = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => workspaceApi.get(workspaceId!),
    enabled: Boolean(workspaceId),
  });

  const recipes = useQuery({
    queryKey: ['recipes', workspaceId, 'active'],
    queryFn: () => recipeApi.list(workspaceId!, { status: 'active' }),
    enabled: Boolean(workspaceId),
  });

  const createMutation = useMutation({
    mutationFn: (values: { title: string; dishCategory?: string }) =>
      recipeApi.create({ workspaceId: workspaceId!, ...values }),
    onSuccess: (recipe) => {
      void queryClient.invalidateQueries({ queryKey: ['recipes'] });
      setCreating(false);
      form.resetFields();
      // 新建后直接进入录音工作台 —— 想起什么就立刻录，不要让人先想"下一步点哪"
      navigate(`/w/${workspaceId}/recipes/${recipe.id}/record`);
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  if (recipes.isLoading || workspace.isLoading) {
    return (
      <div className="froa-center-page">
        <Spin size="large" />
      </div>
    );
  }

  const list = recipes.data ?? [];
  const isViewer = workspace.data?.role === 'viewer';

  return (
    <div>
      <div className="froa-page-title">
        <div>
          <h1>{workspace.data?.name ?? '家庭空间'}</h1>
          <div className="froa-hint">
            邀请码 <strong>{workspace.data?.inviteCode}</strong> ｜ 我的角色：
            {workspace.data ? workspace.data.role : '—'}
          </div>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          disabled={isViewer}
          onClick={() => setCreating(true)}
        >
          新建食谱
        </Button>
      </div>

      {list.length === 0 ? (
        <Empty
          description={
            <span>
              这里还没有食谱。
              <br />
              点击「新建食谱」，然后请长辈说说这道菜怎么做。
            </span>
          }
        >
          <Button type="primary" onClick={() => setCreating(true)} disabled={isViewer}>
            新建第一道菜
          </Button>
        </Empty>
      ) : (
        <div className="froa-grid">
          {list.map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} workspaceId={workspaceId!} />
          ))}
        </div>
      )}

      <Modal
        forceRender
        open={creating}
        title="新建食谱"
        onCancel={() => setCreating(false)}
        onOk={() => form.submit()}
        confirmLoading={createMutation.isPending}
        okText="创建并开始录音"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item
            label="这道菜叫什么"
            name="title"
            rules={[{ required: true, message: '请填写菜名' }]}
          >
            <Input size="large" placeholder="外婆的红烧肉" />
          </Form.Item>
          <Form.Item label="分类（可选）" name="dishCategory">
            <Input size="large" placeholder="荤菜 / 汤 / 主食…" />
          </Form.Item>
          <Typography.Text type="secondary">
            创建后会自动生成第一版草稿，直接就能开始记录口述。
          </Typography.Text>
        </Form>
      </Modal>
    </div>
  );
}

function RecipeCard({ recipe, workspaceId }: { recipe: RecipeDto; workspaceId: string }) {
  const counters = recipe.counters;
  const todo =
    (counters?.openVagueItems ?? 0) + (counters?.askedVagueItems ?? 0) + (counters?.answeredVagueItems ?? 0);

  return (
    <div className="froa-card">
      <h3 className="froa-card-title">{recipe.title}</h3>
      <div className="froa-item-meta">
        {recipe.dishCategory && <span>{recipe.dishCategory}</span>}
        <span>
          {counters?.publishedVersionNo
            ? `已发布 v${counters.publishedVersionNo}`
            : counters?.hasDraft
              ? '草稿中'
              : '未开始'}
        </span>
      </div>

      <div className="froa-stat-row">
        <span className="froa-stat">
          待澄清 <strong>{counters?.openVagueItems ?? 0}</strong>
        </span>
        <span className="froa-stat">
          追问中 <strong>{counters?.askedVagueItems ?? 0}</strong>
        </span>
        <span className="froa-stat">
          待整理 <strong>{counters?.answeredVagueItems ?? 0}</strong>
        </span>
        <span className="froa-stat">
          待复做 <strong>{counters?.resolvedVagueItems ?? 0}</strong>
        </span>
        {counters?.pendingTranscriptCount ? (
          <span className="froa-stat">
            待转写 <strong>{counters.pendingTranscriptCount}</strong>
          </span>
        ) : null}
      </div>

      <div className="froa-row" style={{ marginTop: '0.75rem' }}>
        <Link to={`/w/${workspaceId}/recipes/${recipe.id}`}>查看</Link>
        <Link to={`/w/${workspaceId}/recipes/${recipe.id}/record`}>录音</Link>
        <Link to={`/w/${workspaceId}/recipes/${recipe.id}/inbox`}>
          追问台{todo > 0 ? `（${todo}）` : ''}
        </Link>
      </div>
    </div>
  );
}
