import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Space, Tag, Tooltip, Typography } from 'antd';
import {
  ClearOutlined,
  AimOutlined,
  MergeCellsOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  ScissorOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  MIN_SENTENCE_MS,
  validateSentenceBoundaries,
  type AudioAttachmentDto,
  type TranscriptSentence,
} from '@froa/shared';
import { audioApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { formatMs, Waveform, type BoundaryDrag } from './Waveform';
import { useAudioPlayback } from '../hooks/useAudioPlayback';

interface TranscriptTimelineProps {
  audio: AudioAttachmentDto;
  /** 保存分句后通知父组件刷新音频对象与整段转写文本 */
  onSaved?: (audio: AudioAttachmentDto) => void;
  /** 点"用这句标记"时，把这句话的区间交给父组件去框选片段 / 建待澄清条目 */
  onUseSentence?: (sentence: TranscriptSentence) => void;
}

let localIdCounter = 0;
function nextLocalId(): string {
  localIdCounter += 1;
  return `e${Date.now()}_${localIdCounter}`;
}

function withIds(sentences: TranscriptSentence[] | null | undefined): TranscriptSentence[] {
  return (sentences ?? []).map((sentence, index) => ({ ...sentence, id: sentence.id ?? `s${index + 1}` }));
}

/**
 * 分句时间轴工作台。
 *
 * 每句话自动落在一个音频区间里，整理者可以：
 * - 点句子试听这一句；
 * - 拖波形上的竖线，把边界挪到真正换气/停顿的位置；
 * - 在某句中间切开（拆分）、把相邻两句并起来（合并）；
 * - 直接改句子文字。
 * 保存时服务端会再做一遍边界校验（不越界、不重叠、非空）。
 */
export function TranscriptTimeline({ audio, onSaved, onUseSentence }: TranscriptTimelineProps) {
  const queryClient = useQueryClient();
  const { playAudio } = useAudioPlayback();
  const [sentences, setSentences] = useState<TranscriptSentence[]>(() => withIds(audio.sentences));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 音频对象换了（刚转写、刚切到另一条语音）时重新载入
  useEffect(() => {
    setSentences(withIds(audio.sentences));
    setDirty(false);
    setNotice(null);
  }, [audio.id, audio.sentences]);

  const boundaries = useMemo(() => {
    if (!sentences.length) return null;
    // 每句的起点构成边界；补上音频结尾，让最后一句的右端也画出来
    return [...sentences.map((sentence) => sentence.startMs), audio.durationMs];
  }, [sentences, audio.durationMs]);

  const errors = useMemo(
    () => validateSentenceBoundaries(sentences, audio.durationMs),
    [sentences, audio.durationMs],
  );
  const errorByIndex = useMemo(() => {
    const map = new Map<number, string>();
    errors.forEach((error) => {
      if (error.index >= 0) map.set(error.index, error.message);
    });
    return map;
  }, [errors]);

  const saveMutation = useMutation({
    mutationFn: () => audioApi.saveSentences(audio.id, sentences),
    onSuccess: (result) => {
      setSentences(withIds(result.sentences));
      setDirty(false);
      setNotice(null);
      onSaved?.(result.audio);
      void queryClient.invalidateQueries({ queryKey: ['audio', audio.recipeId] });
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  const resegmentMutation = useMutation({
    mutationFn: () => audioApi.resegment(audio.id),
    onSuccess: (result) => {
      setSentences(withIds(result.sentences));
      setDirty(false);
      setNotice(null);
      onSaved?.(result.audio);
    },
    onError: (error) => setNotice(errorMessage(error)),
  });

  const updateSentence = (id: string, patch: Partial<TranscriptSentence>) => {
    setSentences((current) => current.map((sentence) => (sentence.id === id ? { ...sentence, ...patch } : sentence)));
    setDirty(true);
  };

  /** 波形上拖动边界：index 是"第 index 句的起点"，同时也是上一句的终点 */
  const handleBoundaryDrag = (drag: BoundaryDrag | null, settled: boolean) => {
    if (!drag) return;
    setSentences((current) => {
      const next = [...current];
      const index = drag.index;
      if (index <= 0 || index >= next.length) return current; // 首/尾边界不可拖
      const prev = next[index - 1];
      const currentSentence = next[index];
      if (!prev || !currentSentence) return current;

      // 夹在前后句之间：不能把相邻句子压没
      const minMs = prev.startMs + MIN_SENTENCE_MS;
      const maxMs = currentSentence.endMs - MIN_SENTENCE_MS;
      const clamped = Math.max(minMs, Math.min(maxMs, drag.ms));
      next[index - 1] = { ...prev, endMs: clamped, source: 'manual' };
      next[index] = { ...currentSentence, startMs: clamped, source: 'manual' };
      return next;
    });
    if (settled) setDirty(true);
  };

  /** 在一句话中间按波形位置切开。文字按时间比例粗分，整理者再改字。 */
  const splitAt = (index: number, ms?: number) => {
    let problem: string | null = null;
    setSentences((current) => {
      const sentence = current[index];
      if (!sentence) return current;
      const point = ms ?? Math.round((sentence.startMs + sentence.endMs) / 2);
      if (point <= sentence.startMs + MIN_SENTENCE_MS || point >= sentence.endMs - MIN_SENTENCE_MS) {
        problem = '切分点太靠近边界了，先把句子拉长或换个位置切';
        return current;
      }
      const ratio = (point - sentence.startMs) / (sentence.endMs - sentence.startMs);
      const chars = Array.from(sentence.text);
      const cut = Math.round(chars.length * ratio);
      const leftText = chars.slice(0, cut).join('').trim();
      const rightText = chars.slice(cut).join('').trim();
      if (!leftText || !rightText) {
        problem = '切分点两侧都要有文字，先把这句话补完整再切';
        return current;
      }
      const next = [...current];
      next[index] = { ...sentence, endMs: point, text: leftText, source: 'manual' };
      next.splice(index + 1, 0, {
        id: nextLocalId(),
        startMs: point,
        endMs: sentence.endMs,
        text: rightText,
        source: 'manual',
      });
      return next;
    });
    // updater 是同步执行的，problem 此时已定：有问题就提示，没有才标记脏状态
    if (problem) {
      setNotice(problem);
      return;
    }
    setDirty(true);
    setNotice(null);
  };

  const mergeWithNext = (index: number) => {
    setSentences((current) => {
      const currentSentence = current[index];
      const following = current[index + 1];
      if (!currentSentence || !following) return current;
      const next = current.filter((_, i) => i !== index + 1);
      next[index] = {
        ...currentSentence,
        endMs: following.endMs,
        text: `${currentSentence.text}${following.text}`,
        source: 'manual',
      };
      return next;
    });
    setDirty(true);
  };

  const removeSentence = (index: number) => {
    if (sentences.length <= 1) {
      setNotice('至少要保留一句话；想清空整段转写请用右上角的文本框');
      return;
    }
    setSentences((current) => {
      const removed = current[index];
      const next = current.filter((_, i) => i !== index);
      if (!removed) return current;
      // 被删句子的区间让给前一句（首句则让给后一句），时间轴不留空档
      if (index > 0) {
        const prev = next[index - 1]!;
        next[index - 1] = { ...prev, endMs: removed.endMs };
      } else {
        const first = next[0]!;
        next[0] = { ...first, startMs: 0 };
      }
      return next;
    });
    setDirty(true);
  };

  const playSentence = (sentence: TranscriptSentence) => {
    setActiveId(sentence.id ?? null);
    playAudio(audio, { startMs: sentence.startMs, endMs: sentence.endMs, label: '试听这一句' });
  };

  if (!sentences.length) {
    return (
      <div className="froa-sentences-empty">
        <Typography.Text type="secondary">
          还没有分句。先在上方录入或自动转写，保存后这里会按句子自动落到音频时间轴上。
        </Typography.Text>
      </div>
    );
  }

  return (
    <div className="froa-sentences">
      <div className="froa-row froa-sentences-toolbar">
        <Space wrap>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saveMutation.isPending}
            disabled={!dirty || errors.length > 0}
            onClick={() => saveMutation.mutate()}
          >
            保存分句与时间轴
          </Button>
          <Tooltip title="丢弃拖过的边界，按当前整段文本重新分句均摊">
            <Button
              icon={<SyncOutlined />}
              loading={resegmentMutation.isPending}
              onClick={() => {
                if (dirty && !window.confirm('重新分句会覆盖你手动调整过的边界，确定吗？')) return;
                resegmentMutation.mutate();
              }}
            >
              重新自动分句
            </Button>
          </Tooltip>
        </Space>
        {dirty ? <Tag color="orange">有未保存的修改</Tag> : <Tag color="green">已对齐 {sentences.length} 句</Tag>}
      </div>

      {dirty && errors.length > 0 && (
        <Typography.Text type="danger" className="froa-sentences-error">
          {errors[0]!.message}（修好后才能保存）
        </Typography.Text>
      )}
      {notice && !errors.length && (
        <Typography.Text type="warning" className="froa-sentences-error">
          {notice}
        </Typography.Text>
      )}

      <Waveform
        peaks={audio.peaks}
        durationMs={audio.durationMs}
        regions={sentences.map((sentence) => ({
          startMs: sentence.startMs,
          endMs: sentence.endMs,
          active: sentence.id === activeId,
        }))}
        boundaries={boundaries}
        onBoundaryDrag={handleBoundaryDrag}
        onSeek={(ms) => playAudio(audio, { startMs: ms, label: '从这里听' })}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: '0.4rem', marginBottom: 0 }}>
        拖动波形上的 <span className="froa-boundary-demo" /> 竖线可以挪句子边界；点句子试听。
      </Typography.Paragraph>

      <ol className="froa-sentence-list">
        {sentences.map((sentence, index) => (
          <li
            key={sentence.id}
            className={`froa-sentence${sentence.id === activeId ? ' is-active' : ''}${
              errorByIndex.has(index) ? ' has-error' : ''
            }`}
          >
            <div className="froa-sentence-time">
              <button
                type="button"
                className="froa-icon-button"
                title="试听这一句"
                onClick={() => playSentence(sentence)}
              >
                <PlayCircleOutlined />
              </button>
              <span>
                {formatMs(sentence.startMs)} – {formatMs(sentence.endMs)}
              </span>
              {sentence.source === 'manual' && (
                <Tooltip title="边界已人工修正">
                  <Tag color="blue" className="froa-sentence-manual">
                    已修正
                  </Tag>
                </Tooltip>
              )}
            </div>

            <Input.TextArea
              value={sentence.text}
              autoSize={{ minRows: 1, maxRows: 4 }}
              onChange={(event) => updateSentence(sentence.id!, { text: event.target.value })}
              className="froa-sentence-text"
            />

            <div className="froa-sentence-actions">
              {onUseSentence && (
                <Tooltip title="把这句的区间设为框选片段，随后可标记为待澄清">
                  <Button size="small" icon={<AimOutlined />} onClick={() => onUseSentence(sentence)}>
                    用这句标记
                  </Button>
                </Tooltip>
              )}
              <Tooltip title="从中间切成两句">
                <Button size="small" icon={<ScissorOutlined />} onClick={() => splitAt(index)}>
                  拆分
                </Button>
              </Tooltip>
              {index + 1 < sentences.length && (
                <Tooltip title="和下一句合并">
                  <Button size="small" icon={<MergeCellsOutlined />} onClick={() => mergeWithNext(index)}>
                    合并下句
                  </Button>
                </Tooltip>
              )}
              <Tooltip title="删除这句，区间并入相邻句">
                <Button size="small" icon={<ClearOutlined />} danger onClick={() => removeSentence(index)}>
                  删除
                </Button>
              </Tooltip>
            </div>

            {errorByIndex.has(index) && (
              <Typography.Text type="danger" className="froa-sentence-row-error">
                {errorByIndex.get(index)}
              </Typography.Text>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
