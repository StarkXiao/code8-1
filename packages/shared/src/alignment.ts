/**
 * 口述转写的分句与时间轴对齐。
 *
 * 这是"为口述转写文本补上分句与时间轴对齐"的核心算法，前后端共用同一份：
 * - 自动分句：按中文口述常见停顿（句末标点、换行、逗号等）切句，
 *   没有标点的长句再按字数硬切，保证任何输入都能落到句子上；
 * - 自动对齐：没有 ASR 时间戳（人工录入）时，按每句字数把整段音频时长均分，
 *   再用波形峰值把边界往最近的"小声音（停顿）"处吸附 ——
 *   说话在停顿处换气，边界落在停顿里才不会把一个词切成两半。
 *
 * 自动对齐只是起点：整理者随后可以在界面上拖动每句边界、改文字，
 * 服务端只接受修正后的完整句子表（见 schemas.ts 的 replaceSegmentsSchema）。
 */

/** 分句与对齐后得到的句子 */
export interface AlignedSegment {
  startMs: number;
  endMs: number;
  text: string;
  /** 是否为整理者手动修正过；自动对齐产物恒为 false */
  edited?: boolean;
}

/**
 * 句末强停顿：直接成句。
 * 同时覆盖中英文标点；问号/叹号/分号在口述里也意味着明显停顿。
 */
const STRONG_DELIMITERS = new Set([
  '。',
  '！',
  '？',
  '；',
  '…',
  '!',
  '?',
  ';',
  '.',
  '\n',
  '\r',
]);

/** 句中弱停顿：逗号类。长句才需要在这些位置切。 */
const WEAK_DELIMITERS = new Set(['，', '、', ',', '：', ':', '—', '~', '～', ' ']);

/** 没有任何标点时，单句允许的最大字数（中文口述约 20~25 字是一口气） */
export const MAX_CLAUSE_CHARS = 24;
/** 单句再长也不超过的硬上限，防止整段没有标点时出现几百字的"句子" */
export const MAX_HARD_CHARS = 40;

/**
 * 把整段转写文本切成句子。
 *
 * 规则：
 * 1. 强停顿直接切（标点附在句尾，保持原话形态）；
 * 2. 得到的片段若超过 MAX_CLAUSE_CHARS，再在弱停顿（逗号等）处切；
 * 3. 仍超长（没有任何标点的长句）按 MAX_HARD_CHARS 硬切；
 * 4. 纯空白被丢弃。
 */
export function splitTranscript(text: string): string[] {
  const sentences: string[] = [];
  let buffer = '';

  const flush = () => {
    const trimmed = buffer.trim();
    // 纯标点（连续的句号/问号…）不成句，只有"文字 + 句末标点"才算一句
    if (trimmed && /\p{L}|\p{N}/u.test(trimmed)) sentences.push(trimmed);
    buffer = '';
  };

  for (const char of text) {
    buffer += char;
    if (STRONG_DELIMITERS.has(char)) flush();
  }
  flush();

  // 第二轮：对超长句在弱停顿处继续切
  const result: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CLAUSE_CHARS) {
      result.push(sentence);
      continue;
    }
    let piece = '';
    let lastWeak = -1;
    for (let i = 0; i < sentence.length; i += 1) {
      const char = sentence[i]!;
      piece += char;
      if (WEAK_DELIMITERS.has(char)) lastWeak = piece.length;
      if (piece.length >= MAX_CLAUSE_CHARS && lastWeak > 0) {
        result.push(piece.slice(0, lastWeak).trim());
        piece = piece.slice(lastWeak);
        lastWeak = -1;
      }
    }
    if (piece.trim()) result.push(piece.trim());
  }

  // 第三轮：硬切没有任何停顿的超长句
  return result.flatMap((sentence) => {
    if (sentence.length <= MAX_HARD_CHARS) return [sentence];
    const chunks: string[] = [];
    for (let i = 0; i < sentence.length; i += MAX_HARD_CHARS) {
      chunks.push(sentence.slice(i, i + MAX_HARD_CHARS));
    }
    return chunks;
  });
}

/**
 * 把一句边界吸附到附近最近的波形低谷（停顿处）。
 *
 * @param targetMs     按字数均分得到的理论边界
 * @param peaks        归一化波形峰值（0..1），均匀覆盖整段音频
 * @param durationMs   音频总时长
 * @param windowMs     允许在理论边界两侧多宽的窗口内找停顿
 * @returns 吸附后的毫秒位置；没有峰值数据时原样返回
 */
export function snapToQuietBoundary(
  targetMs: number,
  peaks: readonly number[] | null | undefined,
  durationMs: number,
  windowMs = 1200,
): number {
  if (!peaks?.length || durationMs <= 0) return targetMs;

  const indexAt = (ms: number) =>
    Math.min(peaks.length - 1, Math.max(0, Math.floor((ms / durationMs) * peaks.length)));

  const lo = Math.max(0, indexAt(targetMs - windowMs));
  const hi = Math.min(peaks.length - 1, indexAt(targetMs + windowMs));

  let bestIndex = indexAt(targetMs);
  let bestEnergy = (peaks[bestIndex] ?? 1) + 1;
  for (let i = lo; i <= hi; i += 1) {
    // 与理论位置越近越好（小权重），声音越小越好（大权重）
    const distancePenalty = Math.abs(i - indexAt(targetMs)) / Math.max(1, hi - lo);
    const score = (peaks[i] ?? 1) + distancePenalty * 0.25;
    if (score < bestEnergy) {
      bestEnergy = score;
      bestIndex = i;
    }
  }
  return Math.round((bestIndex / peaks.length) * durationMs);
}

export interface DistributeOptions {
  /** 客户端预计算的波形峰值，用于停顿吸附 */
  peaks?: readonly number[] | null;
  /** 是否启用停顿吸附，默认 true */
  snap?: boolean;
}

/**
 * 把 N 句文字按字数比例分布到 [0, durationMs] 上。
 *
 * 首句固定从 0 开始、末句固定在 durationMs 结束（覆盖整段音频）；
 * 中间边界 = 累计字数比例位置，再（可选）吸附到波形停顿处，
 * 最后强制相邻边界有序、间隔不小于 minSegmentMs。
 */
export function distributeSegments(
  sentences: readonly string[],
  durationMs: number,
  options: DistributeOptions = {},
): AlignedSegment[] {
  const count = sentences.length;
  if (count === 0) return [];
  if (count === 1 || durationMs <= 0) {
    return sentences.map((text) => ({ startMs: 0, endMs: Math.max(0, durationMs), text }));
  }

  const weights = sentences.map((sentence) => Math.max(1, sentence.length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const snapEnabled = options.snap !== false;
  const rawBoundaries: number[] = [0];
  let cumulative = 0;
  for (let i = 0; i < count - 1; i += 1) {
    cumulative += weights[i]!;
    const proportional = Math.round((cumulative / totalWeight) * durationMs);
    rawBoundaries.push(
      snapEnabled ? snapToQuietBoundary(proportional, options.peaks ?? null, durationMs) : proportional,
    );
  }
  rawBoundaries.push(durationMs);

  // 强制单调与最小句长，避免吸附后两句重叠。
  // 句数太多、音频太短时，按"平均时长的六成"缩小下限，否则会挤成 0 长度。
  const averageSegmentMs = durationMs / count;
  const minSegmentMs = Math.min(250, Math.max(30, Math.floor(averageSegmentMs * 0.6)));
  const boundaries = rawBoundaries.slice();
  for (let i = 1; i < count; i += 1) {
    boundaries[i] = Math.max(boundaries[i]!, boundaries[i - 1]! + minSegmentMs);
  }
  for (let i = count; i > 0; i -= 1) {
    if (boundaries[i]! - boundaries[i - 1]! < minSegmentMs) {
      boundaries[i - 1] = Math.max(0, boundaries[i]! - minSegmentMs);
    }
  }

  return sentences.map((text, index) => ({
    startMs: boundaries[index]!,
    endMs: boundaries[index + 1]!,
    text,
  }));
}

/**
 * 一键自动对齐：分句 + 按字数（+停顿吸附）落到音频区间。
 * 人工转写没有 ASR 时间戳时走这条路径。
 */
export function autoAlignTranscript(
  text: string,
  durationMs: number,
  peaks?: readonly number[] | null,
): AlignedSegment[] {
  return distributeSegments(splitTranscript(text), durationMs, { peaks });
}

/**
 * 规整整理者提交的分句表：
 * - 去掉空白句（不允许保存空句子）；
 * - 校验每句都在音频范围内（允许 100ms 的编码误差）；
 * - 强制 start < end、相邻边界有序；
 * - 按顺序重排。
 *
 * 返回 null 表示输入无效（超出音频范围、空表、重叠等），调用方应拒绝保存。
 */
export function normalizeSegments(
  segments: readonly AlignedSegment[],
  durationMs: number,
): AlignedSegment[] | null {
  if (durationMs <= 0) return null;

  const cleaned = segments
    .map((segment) => ({ ...segment, text: segment.text.trim() }))
    .filter((segment) => segment.text.length > 0);
  if (!cleaned.length) return null;

  // 超出音频范围是"拖过头 / 用了旧音频数据"，必须明确拒绝，
  // 不能悄悄裁到音频末尾 —— 那样最后一句会被拉长，整理者却以为保存的是原值。
  const toleranceMs = 100;
  const outOfRange = cleaned.some(
    (segment) =>
      segment.startMs < 0 ||
      segment.endMs < 0 ||
      segment.startMs > durationMs + toleranceMs ||
      segment.endMs > durationMs + toleranceMs,
  );
  if (outOfRange) return null;

  const normalized = cleaned
    .map((segment) => ({
      startMs: Math.round(segment.startMs),
      endMs: Math.min(durationMs, Math.round(segment.endMs)),
      text: segment.text.slice(0, 2000),
      ...(segment.edited ? { edited: true } : {}),
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  for (const segment of normalized) {
    if (segment.endMs <= segment.startMs) return null;
  }
  for (let i = 1; i < normalized.length; i += 1) {
    if (normalized[i]!.startMs < normalized[i - 1]!.endMs) return null;
  }

  return normalized;
}
