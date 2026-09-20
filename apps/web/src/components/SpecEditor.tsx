import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Radio, Select, Space, Typography } from 'antd';
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_LEVELS,
  SPEC_CATEGORY_HINTS,
  VAGUE_CATEGORIES,
  VAGUE_CATEGORY_LABELS,
  validateResolvedSpec,
  type Confidence,
  type ResolvedSpec,
  type VagueCategory,
} from '@froa/shared';

export interface SpecEditorProps {
  category: VagueCategory;
  /** 已有的结论（重新整理时回填） */
  initial?: ResolvedSpec | null;
  /** 自动继承的证据：原声片段 */
  clipId?: string | null;
  /** 可选答复人 */
  members?: { userId: string; displayName: string }[];
  submitting?: boolean;
  onSubmit: (spec: ResolvedSpec) => void;
  onCancel?: () => void;
  submitText?: string;
}

interface FormValues {
  type: VagueCategory;
  value?: number | null;
  unit?: string | null;
  rangeMin?: number | null;
  rangeMax?: number | null;
  reference?: string | null;
  criterion?: string | null;
  substitute?: string | null;
  confidence: Confidence;
  answeredBy?: string | null;
}

/**
 * 可复做规格编辑器。
 *
 * 这是把"一点糖"变成"4g（白瓷勺半勺）"的地方。
 * 客户端先用同一份 validateResolvedSpec 预校验，提交后服务端再校验一次 ——
 * 规则只有一份（@froa/shared），不会前后端不一致。
 */
export function SpecEditor({
  category,
  initial,
  clipId,
  members = [],
  submitting,
  onSubmit,
  onCancel,
  submitText = '保存为可复做结论',
}: SpecEditorProps) {
  const [form] = Form.useForm<FormValues>();
  const [issues, setIssues] = useState<{ field: string; message: string }[]>([]);
  const type = Form.useWatch('type', form) ?? category;

  useEffect(() => {
    const values: FormValues = {
      type: initial?.type ?? category,
      value: initial?.value ?? null,
      unit: initial?.unit ?? null,
      rangeMin: initial?.range?.min ?? null,
      rangeMax: initial?.range?.max ?? null,
      reference: initial?.reference ?? null,
      criterion: initial?.criterion ?? null,
      substitute: initial?.substitute ?? null,
      confidence: initial?.confidence ?? 'assumed',
      answeredBy: initial?.evidence?.answeredBy ?? null,
    };
    form.setFieldsValue(values);
  }, [form, initial, category]);

  const submit = (values: FormValues) => {
    const spec: ResolvedSpec = {
      type: values.type,
      value: values.value ?? null,
      unit: values.unit ?? null,
      range:
        values.rangeMin !== null && values.rangeMin !== undefined &&
        values.rangeMax !== null && values.rangeMax !== undefined
          ? { min: values.rangeMin, max: values.rangeMax }
          : null,
      reference: values.reference ?? null,
      criterion: values.criterion ?? null,
      substitute: values.substitute ?? null,
      evidence: {
        clipId: clipId ?? initial?.evidence?.clipId ?? null,
        answeredBy: values.answeredBy ?? initial?.evidence?.answeredBy ?? null,
        answeredAt: initial?.evidence?.answeredAt ?? null,
      },
      confidence: values.confidence,
      notes: initial?.notes ?? null,
    };

    const found = validateResolvedSpec(spec);
    setIssues(found);
    if (found.length) return;
    onSubmit(spec);
  };

  const needsValue = type === 'amount' || type === 'time';
  const needsCriterion = type !== 'amount';

  return (
    <Form form={form} layout="vertical" onFinish={submit} className="froa-spec-editor">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message={SPEC_CATEGORY_HINTS[type]}
      />

      {issues.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message="还差一点"
          description={
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {issues.map((issue) => (
                <li key={`${issue.field}-${issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          }
        />
      )}

      <Form.Item label="分类" name="type" rules={[{ required: true }]}>
        <Select
          options={VAGUE_CATEGORIES.map((value) => ({
            value,
            label: VAGUE_CATEGORY_LABELS[value],
          }))}
        />
      </Form.Item>

      {needsValue && (
        <Space align="start" wrap>
          <Form.Item label="具体数值" name="value">
            <InputNumber min={0} step={0.5} style={{ width: 130 }} placeholder="4" />
          </Form.Item>

          {type === 'amount' && (
            <Form.Item label="单位" name="unit">
              <Input style={{ width: 110 }} placeholder="g / ml / 勺" />
            </Form.Item>
          )}

          <Form.Item label="区间下限" name="rangeMin">
            <InputNumber min={0} step={0.5} style={{ width: 120 }} placeholder="3" />
          </Form.Item>
          <Form.Item label="区间上限" name="rangeMax">
            <InputNumber min={0} step={0.5} style={{ width: 120 }} placeholder="5" />
          </Form.Item>
        </Space>
      )}

      {needsCriterion && (
        <Form.Item
          label={type === 'heat' ? '判断标准（看到/听到/闻到什么）' : '判断标准 / 手感描述'}
          name="criterion"
        >
          <Input.TextArea
            rows={3}
            placeholder={
              type === 'heat'
                ? '糖全部化开、颜色变成枣红色、闻到焦糖香'
                : type === 'feel'
                  ? '像耳垂一样软，按下去缓慢回弹'
                  : '筷子能轻松插透'
            }
          />
        </Form.Item>
      )}

      <Form.Item label="参照物 / 依据" name="reference">
        <Input placeholder="外婆家白瓷勺一平勺 8g，这里是半勺" />
      </Form.Item>

      <Form.Item label="替代方案（可选）" name="substitute">
        <Input placeholder="没有冰糖可用白砂糖，用量减 1/3" />
      </Form.Item>

      <Form.Item label="置信度" name="confidence" rules={[{ required: true }]}>
        <Radio.Group>
          {CONFIDENCE_LEVELS.map((level) => (
            <Radio.Button key={level} value={level}>
              {CONFIDENCE_LABELS[level]}
            </Radio.Button>
          ))}
        </Radio.Group>
      </Form.Item>

      <Form.Item label="这条结论是谁说的（可选）" name="answeredBy">
        <Select
          allowClear
          placeholder="选择答复人"
          options={members.map((member) => ({ value: member.userId, label: member.displayName }))}
        />
      </Form.Item>

      <Typography.Paragraph type="secondary" style={{ fontSize: '0.85rem' }}>
        {clipId
          ? '这条结论会自动关联原声片段，之后任何人都能一键回放核对。'
          : '这条还没有原声片段。结论仍然会记录答复人，但建议之后补一段录音。'}
      </Typography.Paragraph>

      <Space>
        <Button type="primary" htmlType="submit" loading={submitting}>
          {submitText}
        </Button>
        {onCancel && <Button onClick={onCancel}>取消</Button>}
      </Space>
    </Form>
  );
}
