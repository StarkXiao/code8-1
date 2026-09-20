import { describe, expect, it } from 'vitest';
import {
  alignAsrSegments,
  alignPlainText,
  joinSentences,
  MIN_SENTENCE_MS,
  normalizeSentences,
  splitSentences,
  validateSentenceBoundaries,
} from '@froa/shared';

describe('中文分句', () => {
  it('按句末标点断开，标点留在上一句', () => {
    expect(splitSentences('先炒糖色。再放肉！最后收汁？')).toEqual(['先炒糖色。', '再放肉！', '最后收汁？']);
  });

  it('连续标点不产生空句', () => {
    expect(splitSentences('真的假的？！行了吧。')).toEqual(['真的假的？！', '行了吧。']);
  });

  it('换行也断句，空白被修剪', () => {
    expect(splitSentences('  第一句\n\n第二句 \n')).toEqual(['第一句', '第二句']);
  });

  it('短句里的逗号不切，长句才在软停顿处切', () => {
    expect(splitSentences('中火，炒到收汁。')).toEqual(['中火，炒到收汁。']);
    const long = '把切成块的五花肉冷水下锅，加入姜片和料酒，大火烧开以后撇干净表面的浮沫，然后捞出来沥干水分。';
    const pieces = splitSentences(long);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join('')).toBe(long);
  });

  it('中英文标点都识别', () => {
    expect(splitSentences('Wait here. Then stir!')).toEqual(['Wait here.', 'Then stir!']);
  });
});

describe('纯文本按字符均摊对齐', () => {
  it('句子首尾贴齐音频首尾，时间单调不重叠', () => {
    const sentences = alignPlainText('第一句话。第二句更长一些。', 10_000);
    expect(sentences).toHaveLength(2);
    expect(sentences[0]!.startMs).toBe(0);
    expect(sentences[1]!.endMs).toBe(10_000);
    expect(sentences[0]!.endMs).toBe(sentences[1]!.startMs);
    // 第二句字数多，分到的时长也更长（5 字 vs 8 字）
    expect(sentences[1]!.endMs - sentences[1]!.startMs).toBeGreaterThan(
      sentences[0]!.endMs - sentences[0]!.startMs,
    );
  });

  it('时长未知时不报错', () => {
    const sentences = alignPlainText('一句。另一句。', 0);
    expect(sentences).toHaveLength(2);
    expect(sentences.every((s) => s.startMs === 0 && s.endMs === 0)).toBe(true);
  });

  it('空文本返回空数组', () => {
    expect(alignPlainText('   \n ', 1000)).toEqual([]);
  });
});

describe('ASR 分段对齐', () => {
  it('单段无标点整段保留并标 asr', () => {
    const result = alignAsrSegments([{ startMs: 1000, endMs: 3000, text: '先炒糖色再放肉' }], 10_000);
    expect(result).toEqual([
      { startMs: 1000, endMs: 3000, text: '先炒糖色再放肉', source: 'asr' },
    ]);
  });

  it('段内按标点细拆，段时长按字符均摊', () => {
    const result = alignAsrSegments([{ startMs: 0, endMs: 10_000, text: '第一句。第二句。' }], 10_000);
    expect(result).toHaveLength(2);
    expect(result[0]!.startMs).toBe(0);
    expect(result[1]!.endMs).toBe(10_000);
    expect(result[0]!.endMs).toBe(result[1]!.startMs);
    expect(result[0]!.source).toBe('aligned');
  });

  it('多段乱序与脏数据被规整：去空句、按起点排序、压进音频长度', () => {
    const result = alignAsrSegments(
      [
        { startMs: 5000, endMs: 6000, text: '后一句' },
        { startMs: 0, endMs: 2000, text: '前一句' },
        { startMs: 3000, endMs: 3000, text: '   ' },
        { startMs: 9000, endMs: 99_999, text: '越界句' },
      ],
      8000,
    );
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.startMs)).toEqual([0, 5000, 8000]);
    expect(result.every((s) => s.endMs <= 8000)).toBe(true);
  });
});

describe('边界规整器', () => {
  it('倒挂的零长度区间被拉开且不破坏有序性', () => {
    const result = normalizeSentences(
      [
        { startMs: 0, endMs: 5000, text: '甲' },
        { startMs: 5000, endMs: 5000, text: '乙' },
        { startMs: 6000, endMs: 7000, text: '丙' },
      ],
      10_000,
    );
    expect(result[1]!.endMs - result[1]!.startMs).toBeGreaterThanOrEqual(MIN_SENTENCE_MS);
    for (let i = 1; i < result.length; i += 1) {
      expect(result[i]!.startMs).toBeGreaterThanOrEqual(result[i - 1]!.endMs);
    }
  });

  it('拼接回整段文本不丢字', () => {
    const text = '糖色炒到枣红色。下入肉块翻炒。加开水没过肉。';
    const sentences = alignPlainText(text, 30_000);
    expect(joinSentences(sentences)).toBe(text);
  });
});

describe('人工拖拽后的边界校验', () => {
  const good = [
    { startMs: 0, endMs: 2000, text: '甲' },
    { startMs: 2000, endMs: 5000, text: '乙' },
  ];

  it('合法区间通过', () => {
    expect(validateSentenceBoundaries(good, 5000)).toEqual([]);
  });

  it('重叠、空文本、越界、零长度都被拦住', () => {
    const errors = validateSentenceBoundaries(
      [
        { startMs: 0, endMs: 3000, text: '甲' },
        { startMs: 2000, endMs: 2000, text: '   ' },
        { startMs: 5000, endMs: 99_000, text: '丙' },
      ],
      6000,
    );
    const messages = errors.map((e) => e.message).join('；');
    expect(messages).toContain('重叠');
    expect(messages).toContain('内容为空');
    expect(messages).toContain('超出');
  });

  it('空列表报错', () => {
    expect(validateSentenceBoundaries([], 1000)).toHaveLength(1);
  });
});
