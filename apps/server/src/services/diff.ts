import type { ChangeSource, DiffEntry, IngredientDto, StepDto, VersionDiffDto } from '@froa/shared';
import { formatSpecSummary } from '@froa/shared';

export interface DiffableVersion {
  id: string;
  versionNo: number;
  steps: StepDto[];
  ingredients: IngredientDto[];
  changeSources?: ChangeSource[];
}

function stepSignature(step: StepDto): string {
  return step.title.trim();
}

function ingredientSignature(ingredient: IngredientDto): string {
  return ingredient.name.trim();
}

function describeStep(step: StepDto | undefined): string {
  if (!step) return '';
  const bits = [
    step.instruction,
    step.heatText ? `火候：${step.heatText}` : '',
    step.heatLevel ? `档位：${step.heatLevel}` : '',
    step.durationSecondsMin !== null || step.durationSecondsMax !== null
      ? `时长：${step.durationSecondsMin ?? '?'}-${step.durationSecondsMax ?? '?'} 秒`
      : '',
    step.sensoryCues.length ? `判断：${step.sensoryCues.join('、')}` : '',
  ].filter(Boolean);
  return bits.join(' | ');
}

function describeIngredient(item: IngredientDto | undefined): string {
  if (!item) return '';
  const amount =
    item.amountValue !== null
      ? `${item.amountValue}${item.amountUnit ?? ''}`
      : item.amountMin !== null || item.amountMax !== null
        ? `${item.amountMin ?? '?'}-${item.amountMax ?? '?'}${item.amountUnit ?? ''}`
        : (item.amountText ?? '未量化');
  const suffix = item.note ? `（${item.note}）` : '';
  return `${item.name} ${amount}${suffix}`;
}

/**
 * 版本差异计算。
 *
 * 对齐策略：
 * - 步骤按 title 对齐（title 相同视为同一步），位置变化记为 moved；
 * - 用量按 name 对齐；
 * - 每条差异附来源（待澄清条目 / 复做反馈），让"为什么改"可追溯。
 */
export function computeVersionDiff(
  base: DiffableVersion,
  target: DiffableVersion,
  sourcesByKey: Map<string, ChangeSource[]> = new Map(),
): VersionDiffDto {
  const entries: DiffEntry[] = [];

  // ---------------- 步骤 ----------------
  const baseSteps = new Map(base.steps.map((step) => [stepSignature(step), step]));
  const targetSteps = new Map(target.steps.map((step) => [stepSignature(step), step]));

  for (const [key, targetStep] of targetSteps) {
    const baseStep = baseSteps.get(key);
    const sources = sourcesByKey.get(`step:${key}`);
    if (!baseStep) {
      entries.push({
        op: 'added',
        section: 'step',
        key,
        label: key,
        before: null,
        after: describeStep(targetStep),
        sources,
      });
      continue;
    }

    const before = describeStep(baseStep);
    const after = describeStep(targetStep);
    if (before !== after) {
      entries.push({ op: 'modified', section: 'step', key, label: key, before, after, sources });
    } else if (baseStep.orderIndex !== targetStep.orderIndex) {
      entries.push({
        op: 'moved',
        section: 'step',
        key,
        label: key,
        before: `第 ${baseStep.orderIndex + 1} 步`,
        after: `第 ${targetStep.orderIndex + 1} 步`,
        sources,
      });
    }
  }

  for (const [key, baseStep] of baseSteps) {
    if (targetSteps.has(key)) continue;
    entries.push({
      op: 'removed',
      section: 'step',
      key,
      label: key,
      before: describeStep(baseStep),
      after: null,
      sources: sourcesByKey.get(`step:${key}`),
    });
  }

  // ---------------- 用量 ----------------
  const baseIngredients = new Map(base.ingredients.map((item) => [ingredientSignature(item), item]));
  const targetIngredients = new Map(target.ingredients.map((item) => [ingredientSignature(item), item]));

  for (const [key, targetItem] of targetIngredients) {
    const baseItem = baseIngredients.get(key);
    const sources = sourcesByKey.get(`ingredient:${key}`);
    if (!baseItem) {
      entries.push({
        op: 'added',
        section: 'ingredient',
        key,
        label: key,
        before: null,
        after: describeIngredient(targetItem),
        sources,
      });
      continue;
    }
    const before = describeIngredient(baseItem);
    const after = describeIngredient(targetItem);
    if (before !== after) {
      entries.push({ op: 'modified', section: 'ingredient', key, label: key, before, after, sources });
    }
  }

  for (const [key, baseItem] of baseIngredients) {
    if (targetIngredients.has(key)) continue;
    entries.push({
      op: 'removed',
      section: 'ingredient',
      key,
      label: key,
      before: describeIngredient(baseItem),
      after: null,
      sources: sourcesByKey.get(`ingredient:${key}`),
    });
  }

  const summary = {
    added: entries.filter((entry) => entry.op === 'added').length,
    removed: entries.filter((entry) => entry.op === 'removed').length,
    modified: entries.filter((entry) => entry.op === 'modified').length,
    moved: entries.filter((entry) => entry.op === 'moved').length,
  };

  return {
    baseVersion: { id: base.id, versionNo: base.versionNo },
    targetVersion: { id: target.id, versionNo: target.versionNo },
    entries,
    summary,
  };
}

/** 某条口述结论在某个时间点上的状态；summary 为 null 表示当时还没有结论 */
export interface SpecSnapshot {
  id: string;
  rawPhrase: string;
  summary: string | null;
}

/**
 * 口述结论的版本间差异。
 *
 * 为什么不能直接比 versionId：一条待澄清条目只有一个 versionId，
 * 不可能同时属于两个版本，按下标配对的结果必然为空 —— 这正是这段逻辑
 * 之前"永远查不出差异"的原因。
 *
 * 现在的做法是比对**两个时间点上重建出来的规格快照**（见 buildSpecSnapshots）：
 *   v1 发布时结论是 4g，v2 发布时是 6g → 差异里就会显示这次调整。
 */
export function computeSpecDiff(base: SpecSnapshot[], target: SpecSnapshot[]): DiffEntry[] {
  const entries: DiffEntry[] = [];
  const baseById = new Map(base.map((item) => [item.id, item]));
  const targetById = new Map(target.map((item) => [item.id, item]));
  const ids = new Set([...baseById.keys(), ...targetById.keys()]);

  for (const id of ids) {
    const before = baseById.get(id);
    const after = targetById.get(id);
    const label = after?.rawPhrase ?? before?.rawPhrase ?? id;

    const beforeSummary = before?.summary ?? null;
    const afterSummary = after?.summary ?? null;
    if (beforeSummary === afterSummary) continue;

    entries.push({
      op: beforeSummary === null ? 'added' : afterSummary === null ? 'removed' : 'modified',
      section: 'spec',
      key: id,
      label,
      before: beforeSummary ?? '未整理',
      after: afterSummary ?? '已重开（结论作废）',
    });
  }

  return entries;
}

/** 把审计日志里的 resolvedSpec 载荷转成人能读懂的一句话 */
export function summarizeLoggedSpec(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  try {
    const spec = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!spec || typeof spec !== 'object') return null;
    return formatSpecSummary(spec as Parameters<typeof formatSpecSummary>[0]);
  } catch {
    return null;
  }
}
