import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VERSION_STATUS_LABELS, type VerificationResult } from '@froa/shared';
import { recipeApi, verificationApi, versionApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';

const RESULT_LABEL: Record<string, string> = {
  success: '成功：跟食谱描述一致',
  partial: '部分成功：大体对，但某些地方对不上',
  fail: '失败：做出来不对',
};

/**
 * 复做验证 —— 闭环真正合上的地方。
 *
 * 规则（也是产品态度）：说"失败"必须写清哪里不一样，
 * 因为偏差会直接变成新的待澄清条目，回到追问台重新整理。
 */
export function VerifyPage() {
  const { workspaceId, recipeId } = useParams<{ workspaceId: string; recipeId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<{
    versionId: string;
    result: VerificationResult;
    deviations?: string;
  }>();
  const [result, setResult] = useState<VerificationResult>('success');

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

  const runs = useQuery({
    queryKey: ['verifications', recipeId],
    queryFn: () => verificationApi.list(recipeId!),
    enabled: Boolean(recipeId),
  });

  const createMutation = useMutation({
    mutationFn: (values: { versionId: string; result: VerificationResult; deviations?: string }) =>
      verificationApi.create(recipeId!, values),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['verifications', recipeId] });
      void queryClient.invalidateQueries({ queryKey: ['vague-items'] });
      void queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
      form.resetFields();

      if (run.result === 'success') {
        message.success('复做成功！相关结论已标记为「已验证」');
        navigate(`/w/${workspaceId}/recipes/${recipeId}`);
      } else {
        const count = run.reopenedItemIds?.length ?? 0;
        message.warning(`已记录偏差，并自动生成 ${count} 条待澄清条目`);
        navigate(`/w/${workspaceId}/recipes/${recipeId}/inbox`);
      }
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  if (versions.isLoading) return <Spin size="large" />;

  const published = versions.data?.find((version) => version.status === 'published');

  return (
    <div className="froa-stack">
      <div className="froa-page-title">
        <div>
          <h1>复做验证 · {recipe.data?.title}</h1>
          <div className="froa-hint">
            按食谱实际做一遍，把结果记下来。这是唯一能证明"整理到位了"的动作。
          </div>
        </div>
        <Link to={`/w/${workspaceId}/recipes/${recipeId}`}>返回食谱</Link>
      </div>

      {!published ? (
        <Empty description="还没有已发布的版本，先把草稿发布出来再验证。" />
      ) : (
        <Card title={`要验证的版本：v${published.versionNo}`}>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="请真的做一次，不要凭印象填"
            description="如果做出来不对，写好哪里不一样。系统会把每条偏差变成新的待澄清条目，回到追问台继续整理。"
          />

          <Form
            form={form}
            layout="vertical"
            initialValues={{ versionId: published.id, result: 'success' }}
            onFinish={(values) => createMutation.mutate(values)}
          >
            <Form.Item label="验证哪个版本" name="versionId" rules={[{ required: true }]}>
              <Select
                options={(versions.data ?? [])
                  .filter((version) => version.status !== 'draft')
                  .map((version) => ({
                    value: version.id,
                    label: `v${version.versionNo} · ${VERSION_STATUS_LABELS[version.status]}`,
                  }))}
              />
            </Form.Item>

            <Form.Item label="结果" name="result" rules={[{ required: true }]}>
              <Radio.Group onChange={(event) => setResult(event.target.value as VerificationResult)}>
                {(['success', 'partial', 'fail'] as VerificationResult[]).map((value) => (
                  <Radio.Button key={value} value={value}>
                    {RESULT_LABEL[value]}
                  </Radio.Button>
                ))}
              </Radio.Group>
            </Form.Item>

            {result !== 'success' && (
              <Form.Item
                label="哪里不一样（必填，一句一条）"
                name="deviations"
                rules={[{ required: true, message: '请写清偏差，否则无法定位问题' }]}
                extra="每一句会变成一条独立的待澄清条目，所以请分开写。"
              >
                <Input.TextArea rows={4} placeholder={'颜色偏浅，糖放少了。\n收汁时间太长，肉有点老。'} />
              </Form.Item>
            )}

            <Space>
              <Button type="primary" htmlType="submit" loading={createMutation.isPending}>
                提交验证
              </Button>
              <Typography.Text type="secondary">
                提交成功后，成功会让相关结论变成「已验证」；失败会自动生成新条目。
              </Typography.Text>
            </Space>
          </Form>
        </Card>
      )}

      <Card title={`历史验证记录（${runs.data?.length ?? 0}）`}>
        {!runs.data?.length ? (
          <Typography.Text type="secondary">还没有人复做过</Typography.Text>
        ) : (
          <div className="froa-stack">
            {runs.data.map((run) => (
              <div key={run.id} className="froa-step-card">
                <div className="froa-row">
                  <Tag color={run.result === 'success' ? 'green' : run.result === 'partial' ? 'gold' : 'red'}>
                    {RESULT_LABEL[run.result]}
                  </Tag>
                  <span>{run.performer?.displayName ?? '某人'}</span>
                  <span className="froa-hint">{run.performedAt.slice(0, 16).replace('T', ' ')}</span>
                  {run.reopenedItemIds?.length ? (
                    <Tag color="orange">新增 {run.reopenedItemIds.length} 条待澄清</Tag>
                  ) : null}
                </div>
                {run.deviations && <p style={{ margin: '0.5rem 0 0' }}>{run.deviations}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
