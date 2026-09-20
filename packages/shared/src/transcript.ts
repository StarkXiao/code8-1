/**
 * 口述转写的分句与时间轴对齐。
 *
 * 两种数据来源：
 * 1. ASR（whisper/openai）直接给出带时间戳的小段 —— 以段为基础，长段再按标点细拆，
 *    段内句子的时间按字符数均摊（贴合"每个字时长近似相等"的口述直觉）；
 * 2. 纯人工录入，只有整段文本 —— 先分句，再把整条音频时长按字符数均摊给各句。
 *
 * 产出的每句话都带 [startMs, endMs)，整理者随后可以在波形上拖拽边界修正。
 * 客户端用于即时预览，服务端用同一份逻辑做入库前的规整与校验。
 */

export interface TranscriptSentence {
  /** 前端临时生成的稳定标识；拖拽时用它定位句子，不参与持久化语义 */
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
  /** asr=来自自动转写；aligned=按字符均摊对齐；manual=边界经人工修正 */
  source?: 'asr' | 'aligned' | 'manual';
}

export interface AsrSegment {
  startMs: number;
  endMs: number;
  text: string;
}

/** 中文口述句末标点；省略号只取第一个字符 */
const SENTENCE_TERMINATORS = new Set(['。', '！', '？', '…', '!', '?']);
/** 这些标点后面可以断句，但语气没句末标点强（只在句子偏长时才断） */
const SOFT_BREAKS = new Set(['；', '，', '、', ';', ',']);
/** 超过这个长度的长句，允许在软停顿处再断一次 */
const LONG_SENTENCE_CHARS = 24;
/** 分句数量上限，防止异常输入炸掉界面与接口 */
const MAX_SENTENCES = 500;
/** 拖拽修正时允许的最小句长（毫秒），再短就没有可听性了 */
export const MIN_SENTENCE_MS = 200;

function countChars(text: string): number {
  let count = 0;
  for (const ch of text) {
    // 只有"发音字符"（汉字、字母、数字）占说话时长；
    // 标点和空白不发音，不能参与时间均摊，否则短句反而因带标点被摊到更多时间
    if (/\p{L}|\p{N}/u.test(ch)) count += 1;
  }
  return count;
}

/**
 * 把一段文本切成句子。
 * 规则（贴合中文口述，也兼容英文）：
 * - 换行优先断句；
 * - 遇到句末标点（。！？…!?）必断，标点留在上一句；
 * - 句子超过 LONG_SENTENCE_CHARS 时，在软停顿（；，、;,）处断；
 * - 连续的句末标点（"？！"）不产生空句。
 */
export function splitSentences(raw: string): string[] {
  const text = raw.replace(/\r\n/g, '\n');
  const sentences: string[] = [];
  let buffer = '';

  const pushBuffer = () => {
    const trimmed = buffer.trim();
    if (trimmed) sentences.push(trimmed);
    buffer = '';
  };

  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i]!;
    if (ch === '\n') {
      pushBuffer();
      continue;
    }

    buffer += ch;

    // 英文句号要小心：小数点（3.5）、缩写（Mr.）后不能断。
    // 规则：下一个非空白字符是大写字母（新句子开头）或已是文本结尾时才断。
    const isTerminal =
      SENTENCE_TERMINATORS.has(ch) ||
      (ch === '.' &&
        (() => {
          let j = i + 1;
          while (j < chars.length && /\s/.test(chars[j]!)) j += 1;
          if (j >= chars.length) return true;
          const next = chars[j]!;
          const prevChar = i > 0 ? chars[i - 1]! : '';
          // 数字两侧的点视为小数点
          if (/\d/.test(prevChar) && /\d/.test(next)) return false;
          return /[A-Z"“]/.test(next);
        })());

    if (isTerminal) {
      // 合并连续标点（"真的？！"），不在中间断开
      while (i + 1 < chars.length && SENTENCE_TERMINATORS.has(chars[i + 1]!)) {
        buffer += chars[i + 1]!;
        i += 1;
      }
      pushBuffer();
      continue;
    }

    // 软停顿：只有当前句已经偏长才断，避免把"中火，炒到收汁"这种短句切碎
    if (SOFT_BREAKS.has(ch) && countChars(buffer) >= LONG_SENTENCE_CHARS) {
      pushBuffer();
    }
  }
  pushBuffer();

  return sentences.slice(0, MAX_SENTENCES);
}

interface TimedUnit {
  text: string;
  /** 权重：非空白字符数；为 0 时退化为 1 */
  weight: number;
}

/**
 * 把 [startMs, endMs] 按权重均摊给一组文本单元。
 * 最后一个单元兜底到 endMs，消除取整误差，保证句子首尾贴齐区间。
 */
function distributeTime(units: TimedUnit[], startMs: number, endMs: number): TranscriptSentence[] {
  const span = Math.max(0, endMs - startMs);
  const totalWeight = units.reduce((sum, unit) => sum + unit.weight, 0) || 1;
  let cursor = startMs;
  let cumulativeWeight = 0;

  return units.map((unit, index) => {
    cumulativeWeight += unit.weight;
    const isLast = index === units.length - 1;
    // 边界位置 = 累计权重占比；最后一句兜底到 endMs 消除取整误差
    const unitEnd = isLast ? endMs : startMs + Math.round((span * cumulativeWeight) / totalWeight);
    const unitStart = cursor;
    const sentence: TranscriptSentence = {
      startMs: unitStart,
      endMs: Math.max(unitStart, unitEnd),
      text: unit.text,
      source: 'aligned',
    };
    cursor = sentence.endMs;
    return sentence;
  });
}

/**
 * 把任意来源的句子列表压进音频长度、去空句、保证非负非零区间。
 * ASR 偶尔会给出越界或倒挂的时间戳，入库前必须规整。
 *
 * 保证产出满足 0 ≤ start₀ ≤ end₀ ≤ start₁ ≤ end₁ ≤ duration；
 * 当某句原始区间为零长度时，尽量向前后各借 MIN_SENTENCE_MS，
 * 密集到借不出空间时退化为 1ms，至少不破坏有序性（人工拖拽时的校验会再提示）。
 */
export function normalizeSentences(
  raw: Array<{ startMs: number; endMs: number; text: string; source?: TranscriptSentence['source'] }>,
  durationMs: number,
): TranscriptSentence[] {
  const upper = durationMs > 0 ? Math.round(durationMs) : null;
  const clamp = (value: number) => {
    let v = Math.max(0, Math.round(value) || 0);
    if (upper !== null) v = Math.min(v, upper);
    return v;
  };

  const sentences: TranscriptSentence[] = raw
    .map((item) => ({ text: item.text?.trim() ?? '', startMs: clamp(item.startMs), endMs: clamp(item.endMs), source: item.source ?? 'aligned' }))
    .filter((item) => item.text)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
    .slice(0, MAX_SENTENCES);

  if (!sentences.length) return [];

  for (let i = 0; i < sentences.length; i += 1) {
    const current = sentences[i]!;
    const previous = i > 0 ? sentences[i - 1]! : null;
    const next = i + 1 < sentences.length ? sentences[i + 1]! : null;
    const prevEnd = previous ? previous.endMs : 0;
    const nextStart = next ? next.startMs : upper ?? Infinity;

    // 起点不能早于上一句结束
    if (current.startMs < prevEnd) current.startMs = prevEnd;

    if (current.endMs <= current.startMs) {
      const start = current.startMs;
      const roomAfter = Math.max(0, nextStart - start);
      const roomBefore = Math.max(0, start - prevEnd);
      const wanted = upper !== null ? Math.min(MIN_SENTENCE_MS, upper - start) : MIN_SENTENCE_MS;

      if (roomAfter >= wanted) {
        current.endMs = start + wanted;
      } else if (roomAfter >= 1) {
        current.endMs = start + roomAfter;
      } else if (roomBefore >= wanted) {
        // 前后句夹得太死，向前借：把起点前移，上一句相应收短
        current.startMs = start - wanted;
        if (previous) previous.endMs = current.startMs;
        current.endMs = start;
      } else if (roomBefore >= 1) {
        current.startMs = start - 1;
        if (previous) previous.endMs = current.startMs;
        current.endMs = start;
      } else {
        current.endMs = start + 1;
      }
    }
  }

  // 排序后的修复可能让最后一句越过音频总长，整体回拉一次
  if (upper !== null) {
    for (let i = sentences.length - 1; i >= 0; i -= 1) {
      const current = sentences[i];
      if (!current) continue;
      if (current.endMs > upper) current.endMs = upper;
      if (current.startMs > current.endMs) current.startMs = current.endMs;
      const previous = i > 0 ? sentences[i - 1] : null;
      if (previous && previous.endMs > current.startMs) {
        previous.endMs = current.startMs;
      }
    }
  }

  return sentences;
}

/**
 * 只有整段文本时的分句对齐：分句后按字符数把整条音频均摊。
 * 这是"人工录入"路径的自动落点 —— 先给个可用的初稿，再由人拖准。
 */
export function alignPlainText(transcript: string, durationMs: number): TranscriptSentence[] {
  const pieces = splitSentences(transcript);
  if (!pieces.length) return [];

  const units: TimedUnit[] = pieces.map((text) => ({ text, weight: Math.max(1, countChars(text)) }));
  // durationMs 未知（0）时全部从 0 开始，等音频元数据补齐后可重新对齐
  const end = Math.max(0, Math.round(durationMs));
  return distributeTime(units, 0, end);
}

/**
 * 基于 ASR 分段的分句对齐：
 * 段内按标点细拆、按字符均摊该段时长；没有标点的短段整段保留。
 */
export function alignAsrSegments(segments: AsrSegment[], durationMs: number): TranscriptSentence[] {
  const result: TranscriptSentence[] = [];

  const sorted = segments
    .filter((segment) => segment.text && segment.text.trim())
    .map((segment) => ({
      startMs: Math.max(0, Math.round(segment.startMs)),
      endMs: Math.max(0, Math.round(segment.endMs)),
      text: segment.text.trim(),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  for (const segment of sorted) {
    const pieces = splitSentences(segment.text);
    if (!pieces.length) continue;

    if (pieces.length === 1) {
      result.push({ startMs: segment.startMs, endMs: segment.endMs, text: pieces[0]!, source: 'asr' });
      continue;
    }

    const units: TimedUnit[] = pieces.map((text) => ({ text, weight: Math.max(1, countChars(text)) }));
    const split = distributeTime(units, segment.startMs, Math.max(segment.endMs, segment.startMs));
    // 段内细拆出的句子，时间戳是均摊估算而不是 ASR 直出
    split.forEach((sentence) => {
      sentence.source = 'aligned';
    });
    result.push(...split);
  }

  if (!result.length) return [];
  return normalizeSentences(result, durationMs);
}

/** 拼接分句文本，作为整段转写存档（句子之间不留额外空格，标点已在句内） */
export function joinSentences(sentences: Array<{ text: string }>): string {
  return sentences.map((sentence) => sentence.text.trim()).filter(Boolean).join('');
}

/** 给分句补前端用的稳定 id（s1, s2, …），已有 id 的保留 */
export function ensureSentenceIds(sentences: TranscriptSentence[]): TranscriptSentence[] {
  return sentences.map((sentence, index) =>
    sentence.id ? sentence : { ...sentence, id: `s${index + 1}` },
  );
}

export interface SentenceBoundaryError {
  index: number;
  message: string;
}

/**
 * 校验人工拖拽/编辑后的分句（服务端入库前的强校验，前端也用它实时提示）：
 * - 至少一句、每句非空；
 * - 起点终点都在音频范围内；
 * - 区间单调不减、不重叠；
 * - 每句至少 MIN_SENTENCE_MS（音频本身够长时）。
 * 返回错误列表；空数组表示通过。
 */
export function validateSentenceBoundaries(
  sentences: Array<{ startMs: number; endMs: number; text: string }>,
  durationMs: number,
): SentenceBoundaryError[] {
  const errors: SentenceBoundaryError[] = [];
  if (!sentences.length) {
    errors.push({ index: -1, message: '请至少保留一句话' });
    return errors;
  }

  const upper = durationMs > 0 ? durationMs : null;
  let previousEnd = 0;

  sentences.forEach((sentence, index) => {
    const start = Math.round(sentence.startMs);
    const end = Math.round(sentence.endMs);

    if (!sentence.text || !sentence.text.trim()) {
      errors.push({ index, message: `第 ${index + 1} 句内容为空` });
    }
    if (!Number.isFinite(start) || start < 0) {
      errors.push({ index, message: `第 ${index + 1} 句起点无效` });
    }
    if (upper !== null && end > upper + 500) {
      errors.push({ index, message: `第 ${index + 1} 句超出了音频长度` });
    }
    if (end <= start) {
      errors.push({ index, message: `第 ${index + 1} 句结束时间必须晚于开始时间` });
    }
    // 重叠判断只看本句起点与上一句终点；与"自身零长度"是两类问题，分别报告
    if (start < previousEnd - 1) {
      errors.push({ index, message: `第 ${index + 1} 句与上一句时间重叠` });
    }
    if (end > start && (upper === null || upper >= MIN_SENTENCE_MS) && end - start < MIN_SENTENCE_MS) {
      errors.push({ index, message: `第 ${index + 1} 句短于 ${MIN_SENTENCE_MS} 毫秒，几乎听不到声音` });
    }
    previousEnd = Math.max(previousEnd, end);
  });

  return errors;
}
