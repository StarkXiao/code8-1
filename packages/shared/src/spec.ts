import { CONFIDENCE_LEVELS, VAGUE_CATEGORIES, type Confidence, type VagueCategory } from './enums';
import type { ResolvedSpec } from './types';

export interface SpecValidationIssue {
  field: string;
  message: string;
}

/**
 * 可复做规格校验器。
 *
 * 规则（来自项目文档 8.3）：
 * - amount: 必须有 value 或 range，且 unit 必填
 * - heat:   必须有 criterion（可观察现象）
 * - feel:   必须有 criterion（手感描述 + 对照物）
 * - time:   必须有 range，或 value，或 criterion
 * - other:  必须有 criterion 或 notes
 * - 所有分类: evidence 至少要能追溯到原声片段或答复人
 */
export function validateResolvedSpec(spec: ResolvedSpec): SpecValidationIssue[] {
  const issues: SpecValidationIssue[] = [];

  if (!VAGUE_CATEGORIES.includes(spec.type)) {
    issues.push({ field: 'type', message: '分类必须是 heat/feel/amount/time/other 之一' });
    return issues;
  }

  const hasNumber = typeof spec.value === 'number' && Number.isFinite(spec.value);
  const hasRange =
    !!spec.range &&
    typeof spec.range.min === 'number' &&
    typeof spec.range.max === 'number' &&
    Number.isFinite(spec.range.min) &&
    Number.isFinite(spec.range.max);
  const criterion = (spec.criterion ?? '').trim();
  const notes = (spec.notes ?? '').trim();

  if (hasRange && spec.range && spec.range.min > spec.range.max) {
    issues.push({ field: 'range', message: '区间下限不能大于上限' });
  }

  switch (spec.type) {
    case 'amount': {
      if (!hasNumber && !hasRange) {
        issues.push({ field: 'value', message: '用量类必须填写具体数值或区间' });
      }
      if (!spec.unit || !spec.unit.trim()) {
        issues.push({ field: 'unit', message: '用量类必须填写单位（g/ml/勺…）' });
      }
      break;
    }
    case 'heat': {
      if (!criterion) {
        issues.push({ field: 'criterion', message: '火候类必须填写可观察的判断标准' });
      }
      break;
    }
    case 'feel': {
      if (!criterion) {
        issues.push({ field: 'criterion', message: '手感类必须填写手感描述与对照物' });
      }
      break;
    }
    case 'time': {
      if (!hasRange && !hasNumber && !criterion) {
        issues.push({ field: 'range', message: '时间类必须填写时长区间、数值或判断标准' });
      }
      break;
    }
    case 'other': {
      if (!criterion && !notes) {
        issues.push({ field: 'criterion', message: '必须填写判断标准或补充说明' });
      }
      break;
    }
  }

  if (!CONFIDENCE_LEVELS.includes(spec.confidence)) {
    issues.push({ field: 'confidence', message: '置信度必须是 confirmed/estimated/assumed' });
  }

  const evidence = spec.evidence ?? {};
  if (!evidence.clipId && !evidence.answeredBy) {
    issues.push({
      field: 'evidence',
      message: '必须提供证据：至少关联一个原声片段或一位答复人',
    });
  }

  return issues;
}

/** 人类可读的规格摘要，用于列表展示与导出 */
export function formatSpecSummary(spec: ResolvedSpec | null | undefined): string {
  if (!spec) return '未整理';
  const parts: string[] = [];

  if (typeof spec.value === 'number') {
    parts.push(`${spec.value}${spec.unit ?? ''}`);
  }
  if (spec.range) {
    parts.push(`${spec.range.min}–${spec.range.max}${spec.unit ?? ''}`);
  }
  if (spec.reference) parts.push(`依据：${spec.reference}`);
  if (spec.criterion) parts.push(`判断：${spec.criterion}`);
  if (spec.substitute) parts.push(`替代：${spec.substitute}`);

  return parts.length ? parts.join('；') : '未整理';
}

/** 把区间折算成一个用于填充表单的代表值 */
export function specRepresentativeValue(spec: ResolvedSpec): number | null {
  if (typeof spec.value === 'number') return spec.value;
  if (spec.range) return Number(((spec.range.min + spec.range.max) / 2).toFixed(2));
  return null;
}

export const SPEC_CATEGORY_HINTS: Record<VagueCategory, string> = {
  heat: '火候要写"看到什么/听到什么/闻到什么"，例如：糖全部化开、变枣红色、闻到焦糖香',
  feel: '手感要写对照物，例如：像耳垂一样软、按下去缓慢回弹',
  amount: '用量要给数值和单位，并注明参照物，例如：半平勺≈4g（外婆家汤勺一平勺≈8g）',
  time: '时间要给区间，并写明怎么判断结束，例如：8–10 分钟，筷子能轻松插透',
  other: '写清判断标准或补充说明',
};

export function clampConfidence(value: string): Confidence {
  return (CONFIDENCE_LEVELS as readonly string[]).includes(value)
    ? (value as Confidence)
    : 'assumed';
}
