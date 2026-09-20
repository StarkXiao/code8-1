import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  App as AntApp,
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  HEAT_LEVELS,
  HEAT_LEVEL_LABELS,
  VERSION_STATUS_LABELS,
  type HeatLevel,
  type StepDto,
} from '@froa/shared';
import { recipeApi, versionApi } from '../../api/endpoints';
import { errorMessage } from '../../api/client';

/**
 * 草稿编辑器。
 *
 * 只有 draft 版本可编辑；已发布版本要改就必须先 fork 出新草稿 ——
 * 这是"版本历史可信"的前提。
 */
export function EditorPage() {
  const { workspaceId, recipeId } = useParams<{ workspaceId: string; recipeId: string }>();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishForm] = Form.useForm<{ changeNote: string }>();
  const [stepForm] = Form.useForm<StepFormValues>();
  const [ingredientForm] = Form.useForm<IngredientFormValues>();
  const [editingStep, setEditingStep] = useState<StepDto | null>(null);
  const [stepModalOpen, setStepModalOpen] = useState(false);

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

  const draft = versions.data?.find((version) => version.status === 'draft');

  const steps = useQuery({
    queryKey: ['steps', draft?.id],
    queryFn: () => versionApi.steps(draft!.id),
    enabled: Boolean(draft?.id),
  });

  const ingredients = useQuery({
    queryKey: ['ingredients', draft?.id],
    queryFn: () => versionApi.ingredients(draft!.id),
    enabled: Boolean(draft?.id),
  });

  const items = useQuery({
    queryKey: ['recipe', recipeId, 'editor-counters'],
    queryFn: () => recipeApi.get(recipeId!),
    enabled: Boolean(recipeId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['steps'] });
    void queryClient.invalidateQueries({ queryKey: ['ingredients'] });
    void queryClient.invalidateQueries({ queryKey: ['versions', recipeId] });
    void queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
  };

  const forkMutation = useMutation({
    mutationFn: () => versionApi.fork(recipeId!, {}),
    onSuccess: () => {
      message.success('已基于已发布版本创建新草稿');
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const saveStepMutation = useMutation({
    mutationFn: async (values: StepFormValues) => {
      // 表单里"判断标准"用分号分隔书写，这里拆成数组再提交
      const payload = {
        title: values.title,
        instruction: values.instruction,
        heatLevel: values.heatLevel ?? null,
        heatText: values.heatText ?? null,
        durationSecondsMin: values.durationSecondsMin ?? null,
        durationSecondsMax: values.durationSecondsMax ?? null,
        sensoryCues: (values.sensoryCuesText ?? '')
          .split(/[;；,，]/)
          .map((part) => part.trim())
          .filter(Boolean),
        tool: values.tool ?? null,
      };
      // 带上读到的版本号时间戳：如果这期间别人改过同一步骤，服务端会返回 409 而不是覆盖
      if (editingStep) {
        return versionApi.updateStep(editingStep.id, {
          ...payload,
          expectedUpdatedAt: editingStep.updatedAt,
        });
      }
      return versionApi.createStep(draft!.id, payload);
    },
    onSuccess: () => {
      setStepModalOpen(false);
      setEditingStep(null);
      stepForm.resetFields();
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const deleteStepMutation = useMutation({
    mutationFn: (stepId: string) => versionApi.deleteStep(stepId),
    onSuccess: invalidate,
    onError: (error) => message.error(errorMessage(error)),
  });

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: string[]) => versionApi.reorderSteps(draft!.id, orderedIds),
    onSuccess: invalidate,
    onError: (error) => message.error(errorMessage(error)),
  });

  const saveIngredientMutation = useMutation({
    mutationFn: (values: IngredientFormValues) => versionApi.createIngredient(draft!.id, values),
    onSuccess: () => {
      ingredientForm.resetFields();
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const deleteIngredientMutation = useMutation({
    mutationFn: (ingredientId: string) => versionApi.deleteIngredient(ingredientId),
    onSuccess: invalidate,
    onError: (error) => message.error(errorMessage(error)),
  });

  const submitMutation = useMutation({
    mutationFn: () => versionApi.submit(draft!.id),
    onSuccess: () => {
      message.success('已提交评审');
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const publishMutation = useMutation({
    mutationFn: (values: { changeNote: string }) => versionApi.publish(draft!.id, values),
    onSuccess: () => {
      message.success('版本已发布');
      setPublishOpen(false);
      publishForm.resetFields();
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  const submitAndPublish = useMutation({
    mutationFn: async (values: { changeNote: string }) => {
      if (draft!.status === 'draft') await versionApi.submit(draft!.id);
      return versionApi.publish(draft!.id, values);
    },
    onSuccess: () => {
      message.success('版本已发布，接下来请找一位家人实际做一遍');
      setPublishOpen(false);
      publishForm.resetFields();
      invalidate();
    },
    onError: (error) => message.error(errorMessage(error)),
  });

  useEffect(() => {
    if (!editingStep) return;
    // 注意：判断标准在 DTO 里是数组、在表单里是分号分隔的文本，
    // 这里必须显式转换，否则"编辑"会把它清空。
    stepForm.setFieldsValue({
      title: editingStep.title,
      instruction: editingStep.instruction,
      heatLevel: editingStep.heatLevel,
      heatText: editingStep.heatText,
      durationSecondsMin: editingStep.durationSecondsMin,
      durationSecondsMax: editingStep.durationSecondsMax,
      sensoryCuesText: editingStep.sensoryCues.join('；'),
      tool: editingStep.tool,
    });
  }, [editingStep, stepForm]);

  if (versions.isLoading) return <Spin size="large" />;

  const canEdit = recipe.data?.myRole === 'owner' || recipe.data?.myRole === 'editor';
  const stepList = steps.data ?? [];

  const move = (index: number, direction: -1 | 1) => {
    const next = [...stepList];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved!);
    reorderMutation.mutate(next.map((step) => step.id));
  };

  return (
    <div className="froa-stack">
      <div className="froa-page-title">
        <div>
          <h1>编辑草稿 · {recipe.data?.title}</h1>
          <div className="froa-hint">
            已发布的版本永远不可修改。要改就先派生一个新草稿，这样"谁在什么时候改了什么"才说得清。
          </div>
        </div>
        <Space wrap>
          <Link to={`/w/${workspaceId}/recipes/${recipeId}`}>
            <Button>返回食谱</Button>
          </Link>
          {draft && (
            <Tag color="gold">
              草稿 v{draft.versionNo} · {VERSION_STATUS_LABELS[draft.status]}
            </Tag>
          )}
        </Space>
      </div>

      {!draft ? (
        <Empty
          description="当前没有草稿版本。已发布的版本要修改，需要先派生一个新草稿。"
        >
          <Button type="primary" onClick={() => forkMutation.mutate()} loading={forkMutation.isPending}>
            基于已发布版本新建草稿
          </Button>
        </Empty>
      ) : (
        <>
          {!canEdit && <Alert type="warning" showIcon message="你的角色只能查看，不能编辑草稿。" />}

          <Card
            title="用量"
            extra={
              canEdit ? (
                <Form
                  form={ingredientForm}
                  layout="inline"
                  onFinish={(values) => saveIngredientMutation.mutate(values)}
                  style={{ rowGap: 8 }}
                >
                  <Form.Item name="name" rules={[{ required: true, message: ' ' }]}>
                    <Input placeholder="食材" style={{ width: 130 }} />
                  </Form.Item>
                  <Form.Item name="amountValue">
                    <InputNumber placeholder="用量" style={{ width: 100 }} />
                  </Form.Item>
                  <Form.Item name="amountUnit">
                    <Input placeholder="单位" style={{ width: 80 }} />
                  </Form.Item>
                  <Form.Item name="note">
                    <Input placeholder="备注（参照物）" style={{ width: 160 }} />
                  </Form.Item>
                  <Button htmlType="submit" icon={<PlusOutlined />} loading={saveIngredientMutation.isPending}>
                    添加
                  </Button>
                </Form>
              ) : null
            }
          >
            {!ingredients.data?.length ? (
              <Typography.Text type="secondary">还没有记录用量</Typography.Text>
            ) : (
              <div className="froa-stack">
                {ingredients.data.map((ingredient) => (
                  <div key={ingredient.id} className="froa-row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      {ingredient.name} ｜{' '}
                      {ingredient.amountValue !== null
                        ? `${ingredient.amountValue}${ingredient.amountUnit ?? ''}`
                        : (ingredient.amountText ?? '未量化')}
                      {ingredient.isVague && <Tag style={{ marginLeft: 8 }}>整理自口述</Tag>}
                      {ingredient.note && <span className="froa-hint">（{ingredient.note}）</span>}
                    </span>
                    {canEdit && (
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => deleteIngredientMutation.mutate(ingredient.id)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title={`步骤（${stepList.length}）`}
            extra={
              canEdit ? (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingStep(null);
                    stepForm.resetFields();
                    setStepModalOpen(true);
                  }}
                >
                  添加步骤
                </Button>
              ) : null
            }
          >
            {stepList.length === 0 ? (
              <Empty description="还没有步骤" />
            ) : (
              <div className="froa-stack">
                {stepList.map((step, index) => (
                  <div key={step.id} className="froa-step-card">
                    <div className="froa-row" style={{ justifyContent: 'space-between' }}>
                      <div className="froa-row">
                        <span className="froa-step-index">{index + 1}</span>
                        <strong>{step.title}</strong>
                        {step.heatLevel && <Tag>{HEAT_LEVEL_LABELS[step.heatLevel]}</Tag>}
                        {step.durationSecondsMin !== null && (
                          <Tag>
                            {step.durationSecondsMin}-{step.durationSecondsMax ?? step.durationSecondsMin} 秒
                          </Tag>
                        )}
                      </div>
                      {canEdit && (
                        <Space>
                          <Button
                            size="small"
                            icon={<ArrowUpOutlined />}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          />
                          <Button
                            size="small"
                            icon={<ArrowDownOutlined />}
                            disabled={index === stepList.length - 1}
                            onClick={() => move(index, 1)}
                          />
                          <Button
                            size="small"
                            onClick={() => {
                              setEditingStep(step);
                              setStepModalOpen(true);
                            }}
                          >
                            编辑
                          </Button>
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => deleteStepMutation.mutate(step.id)}
                          />
                        </Space>
                      )}
                    </div>
                    <p style={{ margin: '0.5rem 0' }}>{step.instruction}</p>
                    {step.sensoryCues.length > 0 && (
                      <div className="froa-hint">判断标准：{step.sensoryCues.join('、')}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="发布">
            <Typography.Paragraph type="secondary">
              发布时必须写清"这次为什么改"。发布后如果有人在复做时发现偏差，系统会自动把可疑结论降级，
              并生成新的待澄清条目 —— 这样闭环才算真的合上。
            </Typography.Paragraph>
            <Space wrap>
              {draft.status === 'draft' && (
                <Button onClick={() => submitMutation.mutate()} loading={submitMutation.isPending}>
                  仅提交评审
                </Button>
              )}
              <Button type="primary" onClick={() => setPublishOpen(true)} disabled={!canEdit}>
                {draft.status === 'draft' ? '提交并发布' : '发布这一版'}
              </Button>
              <Link to={`/w/${workspaceId}/recipes/${recipeId}/versions`}>
                <Button>查看版本历史</Button>
              </Link>
            </Space>
          </Card>
        </>
      )}

      <Modal
        forceRender
        open={stepModalOpen}
        title={editingStep ? '编辑步骤' : '添加步骤'}
        onCancel={() => {
          setStepModalOpen(false);
          setEditingStep(null);
        }}
        onOk={() => stepForm.submit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={saveStepMutation.isPending}
        width={640}
      >
        <Form form={stepForm} layout="vertical" onFinish={(values) => saveStepMutation.mutate(values)}>
          <Form.Item label="步骤名" name="title" rules={[{ required: true, message: '请填写步骤名' }]}>
            <Input placeholder="炒糖色" />
          </Form.Item>
          <Form.Item
            label="可复做描述"
            name="instruction"
            rules={[{ required: true, message: '请写清怎么做' }]}
          >
            <Input.TextArea rows={3} placeholder="锅里放油和糖，中小火慢慢炒到糖化开变枣红色" />
          </Form.Item>
          <Space wrap>
            <Form.Item label="火候档位" name="heatLevel">
              <Select
                allowClear
                style={{ width: 140 }}
                options={HEAT_LEVELS.map((level: HeatLevel) => ({
                  value: level,
                  label: HEAT_LEVEL_LABELS[level],
                }))}
              />
            </Form.Item>
            <Form.Item label="原话火候" name="heatText">
              <Input placeholder="中小火" style={{ width: 140 }} />
            </Form.Item>
            <Form.Item label="最短秒数" name="durationSecondsMin">
              <InputNumber min={0} style={{ width: 110 }} />
            </Form.Item>
            <Form.Item label="最长秒数" name="durationSecondsMax">
              <InputNumber min={0} style={{ width: 110 }} />
            </Form.Item>
          </Space>
          <Form.Item
            label="判断标准（用分号隔开，例如：变枣红色；闻到焦糖香）"
            name="sensoryCuesText"
          >
            <Input placeholder="变枣红色；闻到焦糖香" />
          </Form.Item>
          <Form.Item label="器具" name="tool">
            <Input placeholder="厚底锅" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        forceRender
        open={publishOpen}
        title="发布版本"
        onCancel={() => setPublishOpen(false)}
        onOk={() => publishForm.submit()}
        okText="确认发布"
        cancelText="取消"
        confirmLoading={submitAndPublish.isPending}
      >
        <Form form={publishForm} layout="vertical" onFinish={(values) => submitAndPublish.mutate(values)}>
          <Form.Item
            label="变更说明（必填）"
            name="changeNote"
            rules={[{ required: true, min: 5, message: '请写清这次改了什么，至少 5 个字' }]}
          >
            <Input.TextArea
              rows={4}
              placeholder={'例如：\n- 把"一点糖"整理为 4g（依据外婆原声回答）\n- 收汁时间从 5 分钟改为 3 分钟'}
            />
          </Form.Item>
          <Typography.Text type="secondary">
            如果还有"暂定"状态的结论没确认，发布会被拦下来 —— 请先回到追问台逐条复核。
          </Typography.Text>
        </Form>
      </Modal>

      <Typography.Text type="secondary" style={{ fontSize: '0.8rem' }}>
        草稿版本号 v{draft?.versionNo ?? '—'}
        {items.data ? ` ｜ 该食谱共有 ${items.data.counters?.verifiedVagueItems ?? 0} 条已验证结论` : ''}
      </Typography.Text>
    </div>
  );
}

interface StepFormValues {
  title: string;
  instruction: string;
  heatLevel?: HeatLevel | null;
  heatText?: string | null;
  durationSecondsMin?: number | null;
  durationSecondsMax?: number | null;
  sensoryCuesText?: string;
  tool?: string | null;
}

interface IngredientFormValues {
  name: string;
  amountValue?: number | null;
  amountUnit?: string | null;
  note?: string | null;
}
