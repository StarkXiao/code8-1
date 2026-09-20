import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Popconfirm, Space, Tag, Tooltip, Typography } from 'antd';
import {
  AimOutlined,
  DeleteOutlined,
  MergeCellsOutlined,
  PlayCircleOutlined,
  ScissorOutlined,
} from '@ant-design/icons';
import type { AlignedSegment, AudioAttachmentDto, TranscriptSegmentDto } from '@froa/shared';
import { audioApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { usePlayerStore } from '../store/player';
import { Waveform, formatMs } from './Waveform';

/** 前端行模型：已保存的句子有 id，自动分句 / 新增句没有 */
export interface EditableSegment {
  id?: string | null;
  startMs: number;
  endMs: number;
  text: string;
  edited?: boolean;
}

interface TranscriptTimelineProps {
  audio: AudioAttachmentDto;
  /** 已保存的分句；为空表示还没对齐过 */
  segments: TranscriptSegmentDto[];
  /** 每次成功保存后通知父级刷新音频对象（新的 transcriptUpdatedAt） */
  onSaved: (audio: AudioAttachmentDto) => void;
  /** 把某一句一键标为待澄清时，先据此建原声片段 */
  onMarkVague?: (segment: EditableSegment) => void;
  /** 是否允许编辑（贡献者及以上）；旁观者只读 */
  readOnly?: boolean;
}

/**
 * 分句 + 时间轴对齐编辑器。
 *
 * 布局上下严格对应：波形上每一格区间，就是下面同序号那一句；
 * 句间边界可以直接在波形上拖（onBoundaryChange），也可以在句子行上微调。
 * 任何修改都先落在本地行状态上（有未保存提示），点"保存对齐结果"整体提交。
 */
export function TranscriptTimeline({
  audio,
  segments: initialSegments,
  onSaved,
  onMarkVague,
  readOnly = false,
}: TranscriptTimelineProps) {
  const { playAudio } = useAudioPlayback();
  const request = usePlayerStore((s) => s.request);
  const currentMs = usePlayerStore((s) => s.currentMs);

  const [rows, setRows] = useState<EditableSegment[]>(() => initialSegments.map(toEditable));
  const [dirty, setDirty] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapped, setSnapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seek = usePlayerStore((s) => s.seek);
  /** 已保存分句的版本戳，用于乐观锁 */
  const versionStampRef = useRef<string | null>(audio.transcriptUpdatedAt);

  // 切换到另一段音频 / 保存成功后，用服务端返回值重置本地状态。
  // 依赖里只放标量：initialSegments 是父级每次渲染新建的数组，直接放依赖会反复重置。
  const signature = initialSegments.map((s) => `${s.id}:${s.startMs}:${s.endMs}`).join('|');
  useEffect(() => {
    setRows(initialSegments.map(toEditable));
    setDirty(false);
    setError(null);
    versionStampRef.current = audio.transcriptUpdatedAt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio.id, audio.transcriptUpdatedAt, signature]);

  const isPlayingThis = request?.audioId === audio.id;
  const playhead = isPlayingThis ? currentMs : undefined;
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  /** 当前播放头落在哪一句里；用于波形高亮与句子行高亮 */
  const activeIndex = useMemo(() => {
    if (playhead === undefined) return null;
    const index = rows.findIndex((row) => playhead >= row.startMs && playhead < row.endMs);
    return index >= 0 ? index : null;
  }, [playhead, rows]);

  // 播放推进到新句子时，把那一行滚动到可见区域（长转写不用手动跟着翻）
  const lastActiveRef = useRef<number | null>(null);
  useEffect(() => {
    if (activeIndex === null || activeIndex === lastActiveRef.current) return;
    lastActiveRef.current = activeIndex;
    rowRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  const patchRow = useCallback((index: number, patch: Partial<EditableSegment>) => {
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch, edited: true } : row)),
    );
    setDirty(true);
  }, []);

  /** 拖波形上的句间边界：boundaryIndex 是左句索引 */
  const handleBoundaryChange = useCallback((boundaryIndex: number, ms: number) => {
    setRows((prev) =>
      prev.map((row, i) => {
        if (i === boundaryIndex) return { ...row, endMs: ms, edited: true };
        if (i === boundaryIndex + 1) return { ...row, startMs: ms, edited: true };
        return row;
      }),
    );
    setDirty(true);
  }, []);

  /** 自动分句 + 对齐（服务端按字数 + 波形停顿计算，不落库） */
  const handleAutoAlign = useCallback(async () => {
    setAligning(true);
    setError(null);
    try {
      const result = await audioApi.alignTranscript(audio.id, { transcript: audio.transcript ?? '' });
      setRows(result.segments.map((segment: AlignedSegment) => ({ ...segment, edited: false })));
      setSnapped(result.snapped);
      setDirty(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAligning(false);
    }
  }, [audio.id, audio.transcript]);

  /** 校验本地行状态：非空、start<end、相邻不重叠、不超出音频 */
  const validationError = useMemo(() => {
    if (!rows.length) return '至少保留一句';
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i]!;
      if (!row.text.trim()) return `第 ${i + 1} 句文字为空，请补内容或删除该句`;
      if (row.endMs <= row.startMs) return `第 ${i + 1} 句时长为 0，请调整边界`;
      if (i > 0 && row.startMs < rows[i - 1]!.endMs) return `第 ${i + 1} 句与上一句重叠了`;
    }
    if (audio.durationMs > 0 && rows[rows.length - 1]!.endMs > audio.durationMs + 500) {
      return '最后一句超出了音频长度';
    }
    return null;
  }, [rows, audio.durationMs]);

  const handleSave = useCallback(async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await audioApi.saveSegments(audio.id, {
        segments: rows.map(({ id, startMs, endMs, text }) => ({ id, startMs, endMs, text: text.trim() })),
        expectedUpdatedAt: versionStampRef.current ?? undefined,
      });
      versionStampRef.current = result.audio.transcriptUpdatedAt;
      setRows((result.audio.segments ?? []).map(toEditable));
      setDirty(false);
      onSaved(result.audio);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [audio.id, rows, validationError, onSaved]);

  /** 在某句中间切开：文字也按时间比例切成两半（切分点保证两侧至少 250ms） */
  const splitRow = useCallback((index: number, atMsRaw: number) => {
    setRows((prev) => {
      const row = prev[index];
      if (!row) return prev;
      const MIN_SPLIT_MS = 250;
      const atMs = Math.min(row.endMs - MIN_SPLIT_MS, Math.max(row.startMs + MIN_SPLIT_MS, atMsRaw));
      if (atMs <= row.startMs || atMs >= row.endMs) return prev;
      const ratio = (atMs - row.startMs) / Math.max(1, row.endMs - row.startMs);
      const charIndex = Math.round(row.text.length * Math.min(1, Math.max(0, ratio)));
      const leftText = row.text.slice(0, charIndex).trim();
      const rightText = row.text.slice(charIndex).trim();
      if (!leftText || !rightText) return prev;
      const next = prev.slice();
      next.splice(index, 1, { ...row, endMs: atMs, text: leftText, edited: true }, {
        id: null,
        startMs: atMs,
        endMs: row.endMs,
        text: rightText,
        edited: true,
      });
      return next;
    });
    setDirty(true);
  }, []);

  /** 合并相邻两句：区间取并集，文字直接相连 */
  const mergeRow = useCallback((index: number) => {
    setRows((prev) => {
      const left = prev[index];
      const right = prev[index + 1];
      if (!left || !right) return prev;
      const next = prev.slice();
      next.splice(index, 2, {
        id: left.id ?? null,
        startMs: left.startMs,
        endMs: right.endMs,
        text: `${left.text}${right.text}`,
        edited: true,
      });
      return next;
    });
    setDirty(true);
  }, []);

  const deleteRow = useCallback((index: number) => {
    setRows((prev) => {
      if (prev.length <= 1) return prev;
      const removed = prev[index];
      if (!removed) return prev;
      // 把被删句子的时间并给前一句（第一句则并给后一句），
      // 避免删除后波形上出现一段"没有任何句子认领"的空档
      const next = prev.filter((_, i) => i !== index);
      if (index > 0) {
        const previous = next[index - 1]!;
        next[index - 1] = { ...previous, endMs: removed.endMs, edited: true };
      } else {
        const following = next[0]!;
        next[0] = { ...following, startMs: removed.startMs, edited: true };
      }
      return next;
    });
    setDirty(true);
  }, []);

  const playRow = useCallback(
    (index: number) => {
      const row = rows[index];
      if (!row) return;
      // 正在播放同一段音频时，点句只是定位 + 跳到句首，不重新发起一次播放请求
      if (isPlayingThis) {
        seek(row.startMs);
        return;
      }
      playAudio(audio, {
        startMs: row.startMs,
        endMs: row.endMs,
        label: `第 ${index + 1} 句 · ${formatMs(row.startMs)}–${formatMs(row.endMs)}`,
      });
    },
    [rows, audio, playAudio, isPlayingThis, seek],
  );

  /** 微调某句起点/终点（±0.1s）；句间边界相邻两句共享，会一起移动 */
  const nudge = useCallback((index: number, edge: 'start' | 'end', deltaMs: number) => {
    setRows((prev) => {
      const row = prev[index];
      if (!row) return prev;
      const prevRow = prev[index - 1];
      const nextRow = prev[index + 1];
      const duration = audio.durationMs || row.endMs;
      let value = (edge === 'start' ? row.startMs : row.endMs) + deltaMs;
      value = Math.round(Math.min(duration, Math.max(0, value)));
      if (edge === 'start') {
        // 不能越过前一句的起点，也不能把本句 / 前一句挤到 250ms 以内
        value = Math.max(prevRow ? prevRow.startMs + 250 : 0, Math.min(row.endMs - 250, value));
        const next = prev.map((r, i) => (i === index ? { ...r, startMs: value, edited: true } : r));
        if (prevRow) next[index - 1] = { ...prevRow, endMs: value, edited: true };
        return next;
      }
      value = Math.min(nextRow ? nextRow.endMs - 250 : duration, Math.max(row.startMs + 250, value));
      const next = prev.map((r, i) => (i === index ? { ...r, endMs: value, edited: true } : r));
      if (nextRow) next[index + 1] = { ...nextRow, startMs: value, edited: true };
      return next;
    });
    setDirty(true);
  }, [audio.durationMs]);

  return (
    <div className="froa-stack">
      <div className="froa-row" style={{ justifyContent: 'space-between' }}>
        <Space wrap>
          <strong>分句与时间轴</strong>
          {rows.length > 0 && <Tag>{rows.length} 句</Tag>}
          {snapped && <Tag color="blue">边界已吸附到停顿处，可再拖动微调</Tag>}
          {dirty && <Tag color="orange">有未保存的修改</Tag>}
        </Space>
        {!readOnly && (
          <Space wrap>
            <Tooltip title="按标点自动分句，按字数分配时长，并把每句边界吸附到附近的停顿处">
              <Button icon={<AimOutlined />} loading={aligning} onClick={handleAutoAlign}>
                {rows.length ? '重新自动分句对齐' : '分句并对齐时间轴'}
              </Button>
            </Tooltip>
            <Button type="primary" disabled={!dirty || Boolean(validationError)} loading={saving} onClick={handleSave}>
              保存对齐结果
            </Button>
          </Space>
        )}
      </div>

      <Waveform
        peaks={audio.peaks}
        durationMs={audio.durationMs}
        height={84}
        segments={rows}
        activeSegmentIndex={activeIndex}
        playheadMs={playhead}
        segmentEditor
        onSeek={(ms) => {
          if (isPlayingThis) seek(ms);
          else {
            // 还没开始播放时点波形：从该位置起播整段（到音频结尾）
            playAudio(audio, { startMs: ms, label: '从点击处播放' });
          }
        }}
        onBoundaryChange={readOnly ? undefined : handleBoundaryChange}
        onSegmentClick={readOnly ? undefined : playRow}
      />

      <Typography.Paragraph type="secondary" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
        波形与下面的句子一一对应。{readOnly ? '' : '拖动波形上的竖柄可修正句间边界；点某句可试听。'}
      </Typography.Paragraph>

      <div className="froa-segments">
        {rows.map((row, index) => (
          <div
            key={`${row.id ?? 'new'}-${index}`}
            ref={(el) => {
              rowRefs.current[index] = el;
            }}
            className={`froa-segment-row${index === activeIndex ? ' is-active' : ''}`}
          >
            <div className="froa-segment-time">
              <Button
                type="text"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => playRow(index)}
                aria-label={`播放第 ${index + 1} 句`}
              />
              <span className="froa-segment-clock">
                {formatMs(row.startMs)}
                <br />– {formatMs(row.endMs)}
              </span>
            </div>

            <div className="froa-segment-body">
              {readOnly ? (
                <div className="froa-segment-text-readonly">{row.text}</div>
              ) : (
                <Input.TextArea
                  value={row.text}
                  autoSize={{ minRows: 1, maxRows: 4 }}
                  onChange={(event) => patchRow(index, { text: event.target.value })}
                  aria-label={`第 ${index + 1} 句文字`}
                />
              )}
              <div className="froa-segment-actions">
                {row.edited && <Tag color="geekblue" style={{ marginInlineEnd: 0 }}>已修正</Tag>}
                {!readOnly && (
                  <>
                    <span className="froa-nudge-group">
                      <Tooltip title="起点 −0.1 秒">
                        <Button size="small" onClick={() => nudge(index, 'start', -100)}>
                          起−
                        </Button>
                      </Tooltip>
                      <Tooltip title="起点 +0.1 秒">
                        <Button size="small" onClick={() => nudge(index, 'start', 100)}>
                          起+
                        </Button>
                      </Tooltip>
                    </span>
                    <span className="froa-nudge-group">
                      <Tooltip title="终点 −0.1 秒">
                        <Button size="small" onClick={() => nudge(index, 'end', -100)}>
                          终−
                        </Button>
                      </Tooltip>
                      <Tooltip title="终点 +0.1 秒">
                        <Button size="small" onClick={() => nudge(index, 'end', 100)}>
                          终+
                        </Button>
                      </Tooltip>
                    </span>
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          { key: 'half', label: '在区间中点切开', icon: <ScissorOutlined /> },
                          {
                            key: 'playhead',
                            label: '在播放头位置切开',
                            icon: <ScissorOutlined />,
                            disabled: playhead === undefined || playhead <= row.startMs || playhead >= row.endMs,
                          },
                        ],
                        onClick: ({ key }) => {
                          const at =
                            key === 'playhead' && playhead !== undefined
                              ? playhead
                              : Math.round((row.startMs + row.endMs) / 2);
                          splitRow(index, at);
                        },
                      }}
                    >
                      <Button size="small" icon={<ScissorOutlined />}>拆句</Button>
                    </Dropdown>
                    <Tooltip title="与下一句合并">
                      <Button
                        size="small"
                        icon={<MergeCellsOutlined />}
                        disabled={index >= rows.length - 1}
                        onClick={() => mergeRow(index)}
                      />
                    </Tooltip>
                    <Popconfirm
                      title="删除这一句？"
                      description="它的时间会并入前一句，不会留下空档。"
                      disabled={rows.length <= 1}
                      onConfirm={() => deleteRow(index)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} disabled={rows.length <= 1} />
                    </Popconfirm>
                    {onMarkVague && (
                      <Button size="small" type="link" onClick={() => onMarkVague(row)}>
                        这句说不清
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && <Typography.Text type="danger">{error}</Typography.Text>}
      {validationError && dirty && !error && (
        <Typography.Text type="warning">{validationError}</Typography.Text>
      )}
    </div>
  );
}

function toEditable(segment: TranscriptSegmentDto): EditableSegment {
  return {
    id: segment.id,
    startMs: segment.startMs,
    endMs: segment.endMs,
    text: segment.text,
    edited: segment.edited,
  };
}
