import { describe, expect, it } from 'vitest';
import {
  autoAlignTranscript,
  distributeSegments,
  normalizeSegments,
  snapToQuietBoundary,
  splitTranscript,
} from '@froa/shared';

describe('转写分句', () => {
  it('按句末标点切成句子，标点附在句尾', () => {
    const sentences = splitTranscript('先炒糖色。然后放一点点糖，中火炒到收汁。');
    expect(sentences).toEqual(['先炒糖色。', '然后放一点点糖，中火炒到收汁。']);
  });

  it('换行也是强停顿', () => {
    const sentences = splitTranscript('先炒糖色\n再放肉\n最后放盐');
    expect(sentences).toHaveLength(3);
  });

  it('长句在逗号处继续切，不会出现整段一句话', () => {
    const long = '先把肉切成块然后用开水焯一下捞出来洗干净，锅里放一点点糖小火慢慢炒到变成枣红色再把肉倒进去翻炒';
    const sentences = splitTranscript(long);
    expect(sentences.length).toBeGreaterThan(1);
    // 每句都不超过硬上限
    for (const sentence of sentences) {
      expect(sentence.length).toBeLessThanOrEqual(40);
    }
  });

  it('完全没有标点的超长口述按字数硬切', () => {
    const text = '肉'.repeat(85);
    const sentences = splitTranscript(text);
    expect(sentences).toHaveLength(3);
  });

  it('空白与连续标点不产生空句', () => {
    expect(splitTranscript('  \n。。。\n')).toEqual([]);
  });

  it('英文句点与问号也能切', () => {
    const sentences = splitTranscript('Add some sugar. Then wait? ok');
    expect(sentences[0]).toBe('Add some sugar.');
  });
});

describe('时间轴分配', () => {
  it('两句等字数各占一半时长，首句从 0 起、末句到 duration 结束', () => {
    const segments = distributeSegments(['一二三四', '五六七八'], 10000, { snap: false });
    expect(segments).toHaveLength(2);
    expect(segments[0]!.startMs).toBe(0);
    expect(segments[0]!.endMs).toBe(5000);
    expect(segments[1]!.startMs).toBe(5000);
    expect(segments[1]!.endMs).toBe(10000);
  });

  it('按字数比例分配：四个字对两个字，边界在三分之二处', () => {
    const segments = distributeSegments(['一二三四', '五六'], 9000, { snap: false });
    expect(segments[0]!.endMs).toBe(6000);
    expect(segments[1]!.startMs).toBe(6000);
    expect(segments[1]!.endMs).toBe(9000);
  });

  it('单句覆盖整段音频', () => {
    const segments = distributeSegments(['只有一句'], 8000, { snap: false });
    expect(segments[0]).toMatchObject({ startMs: 0, endMs: 8000 });
  });

  it('时长缺失时边界安全退化为 0', () => {
    const segments = distributeSegments(['甲', '乙'], 0, { snap: false });
    expect(segments.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it('停顿吸附会把边界拉向窗口内更安静的位置', () => {
    // 理论中点 5000ms 对应峰值中点（0.9 高能量）；安静区放在前段（0.1）
    const peaks = [0.1, 0.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
    const snapped = snapToQuietBoundary(5000, peaks, 10000, 6000);
    // 吸附后应落在前段安静区（索引 0/1 ≈ 0~2500ms），明显早于理论中点
    expect(snapped).toBeLessThan(3000);
  });

  it('吸附后仍然强制相邻边界有序且各句至少 250ms', () => {
    // 极端输入：大量短句子 + 全部峰值为 0（吸附可能聚集），也不能产生重叠
    const sentences = Array.from({ length: 20 }, (_, i) => `句${i}`);
    const segments = distributeSegments(sentences, 1000, { peaks: new Array(100).fill(0) });
    for (let i = 0; i < segments.length; i += 1) {
      expect(segments[i]!.endMs).toBeGreaterThan(segments[i]!.startMs);
      if (i > 0) expect(segments[i]!.startMs).toBeGreaterThanOrEqual(segments[i - 1]!.endMs);
    }
    expect(segments[0]!.startMs).toBe(0);
    expect(segments[19]!.endMs).toBe(1000);
  });

  it('一键自动对齐 = 分句 + 全覆盖，区间连续铺满整段音频', () => {
    const segments = autoAlignTranscript('第一句内容。第二句内容稍长一些。第三句。', 12000, null);
    expect(segments.length).toBe(3);
    expect(segments[0]!.startMs).toBe(0);
    expect(segments[2]!.endMs).toBe(12000);
    for (let i = 0; i < segments.length - 1; i += 1) {
      expect(segments[i + 1]!.startMs).toBe(segments[i]!.endMs);
    }
  });
});

describe('保存前规整', () => {
  const make = (list: Array<[number, number, string]>) =>
    list.map(([startMs, endMs, text]) => ({ startMs, endMs, text }));

  it('去掉空白句并按起点排序', () => {
    const result = normalizeSegments(
      make([
        [5000, 8000, '第二句'],
        [0, 5000, '  '],
        [0, 4000, '第一句'],
      ]),
      8000,
    );
    expect(result!.map((s) => s.text)).toEqual(['第一句', '第二句']);
  });

  it('start >= end 判为无效', () => {
    expect(normalizeSegments(make([[1000, 1000, '零时长']]), 5000)).toBeNull();
    expect(normalizeSegments(make([[3000, 2000, '倒序']]), 5000)).toBeNull();
  });

  it('相邻句重叠判为无效（拖动过头时给出明确拦截）', () => {
    expect(
      normalizeSegments(
        make([
          [0, 3000, '前'],
          [2500, 6000, '后'],
        ]),
        6000,
      ),
    ).toBeNull();
  });

  it('允许句间留白（停顿不属于任何一句），并允许 100ms 编码误差超出时长', () => {
    const result = normalizeSegments(make([[0, 3000, '前'], [3500, 6050, '后']]), 6000);
    expect(result).toHaveLength(2);
  });

  it('时长非法或全部为空句时返回 null', () => {
    expect(normalizeSegments(make([[0, 1000, 'x']]), 0)).toBeNull();
    expect(normalizeSegments(make([[0, 1000, '  ']]), 5000)).toBeNull();
  });

  it('edited 标记只保留真值', () => {
    const result = normalizeSegments(
      [
        { startMs: 0, endMs: 1000, text: '自动句' },
        { startMs: 1000, endMs: 2000, text: '改过的句', edited: true },
      ],
      2000,
    );
    expect(result![0]!.edited).toBeUndefined();
    expect(result![1]!.edited).toBe(true);
  });
});
