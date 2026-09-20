import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface WaveformSelection {
  startMs: number;
  endMs: number;
}

/** 时间轴上的一个分句区间（只取组件需要的字段） */
export interface WaveformSegment {
  startMs: number;
  endMs: number;
}

interface WaveformProps {
  peaks: number[] | null;
  durationMs: number;
  height?: number;
  selection?: WaveformSelection | null;
  playheadMs?: number;
  /** 允许拖拽框选片段；不传表示只读 */
  onSelect?: (selection: WaveformSelection | null) => void;
  onSeek?: (ms: number) => void;
  emptyHint?: string;
  /** 分句时间轴：传入后会在波形上画出每句的区间与边界 */
  segments?: WaveformSegment[] | null;
  /** 当前正在播放 / 选中的那句（高亮） */
  activeSegmentIndex?: number | null;
  /**
   * 分句对齐编辑模式：
   * - true 时点击句子内部定位播放、拖句子之间的边界手柄调整时间轴；
   * - false（默认）时维持原有"按住拖选片段"的行为。
   */
  segmentEditor?: boolean;
  /** 拖动句间边界（index 是被拖动的边界，等于 segments[index] 的 end / segments[index+1] 的 start） */
  onBoundaryChange?: (boundaryIndex: number, ms: number) => void;
  /** 点击某句（点句内定位 + 播放由父级控制） */
  onSegmentClick?: (index: number) => void;
}

/** 距离句间手柄多少像素内按下，视为"抓手柄"而不是"框选 / 定位" */
const HANDLE_HIT_PX = 7;
/** 相邻两句边界允许的最小间隔（毫秒），防止拖出 0 长度的句子 */
const MIN_SEGMENT_MS = 250;

/**
 * 轻量波形组件。
 *
 * 峰值来自服务端存的 peaks（由浏览器端 Web Audio 预计算），
 * 因此渲染波形不需要重新下载整个音频，也不需要 ffmpeg。
 */
export function Waveform({
  peaks,
  durationMs,
  height = 96,
  selection,
  playheadMs,
  onSelect,
  onSeek,
  emptyHint = '这段音频还没有波形数据',
  segments,
  activeSegmentIndex,
  segmentEditor = false,
  onBoundaryChange,
  onSegmentClick,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);
  /** 正在拖动的句间边界索引；非 null 时其余指针行为让位 */
  const [draggingBoundary, setDraggingBoundary] = useState<number | null>(null);

  // 容器宽度变化时重绘（响应式）
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setWidth(Math.max(200, Math.floor(rect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const normalized = useMemo(() => (peaks?.length ? peaks : null), [peaks]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!normalized) return;

    const mid = height / 2;
    const barWidth = width / normalized.length;

    ctx.fillStyle = '#c9a88c';
    normalized.forEach((value, index) => {
      const amplitude = Math.max(1, value * (height / 2 - 4));
      ctx.fillRect(index * barWidth, mid - amplitude, Math.max(1, barWidth - 1), amplitude * 2);
    });

    // 已播放部分用主色覆盖，形成进度感
    if (playheadMs && durationMs > 0) {
      const ratio = Math.min(1, Math.max(0, playheadMs / durationMs));
      const playedWidth = width * ratio;
      ctx.fillStyle = '#8c4a24';
      normalized.forEach((value, index) => {
        const x = index * barWidth;
        if (x > playedWidth) return;
        const amplitude = Math.max(1, value * (height / 2 - 4));
        ctx.fillRect(x, mid - amplitude, Math.min(barWidth - 1, playedWidth - x), amplitude * 2);
      });
    }
  }, [normalized, width, height, playheadMs, durationMs]);

  const positionToMs = useCallback(
    (clientX: number): number => {
      const element = containerRef.current;
      if (!element) return 0;
      const rect = element.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return Math.round(ratio * durationMs);
    },
    [durationMs],
  );

  /** 找到点击位置附近的句间边界：返回的索引 i 表示 segments[i]/segments[i+1] 之间 */
  const boundaryAtPointer = useCallback(
    (clientX: number): number | null => {
      if (!segments?.length || durationMs <= 0) return null;
      const element = containerRef.current;
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const px = clientX - rect.left;
      const hitMs = (HANDLE_HIT_PX / rect.width) * durationMs;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const boundaryMs = segments[i]!.endMs;
        const boundaryPx = (boundaryMs / durationMs) * rect.width;
        if (Math.abs(boundaryPx - px) <= HANDLE_HIT_PX) return i;
        // 点得很近但还没进像素命中区时，也允许按毫秒窗口抓到（窄屏友好）
        const clickMs = positionToMs(clientX);
        if (Math.abs(clickMs - boundaryMs) <= Math.max(hitMs, 120)) return i;
      }
      return null;
    },
    [segments, durationMs, positionToMs],
  );

  const segmentIndexAt = useCallback(
    (clientX: number): number | null => {
      if (!segments?.length) return null;
      const ms = positionToMs(clientX);
      const index = segments.findIndex((segment) => ms >= segment.startMs && ms < segment.endMs);
      return index >= 0 ? index : null;
    },
    [segments, positionToMs],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!normalized) return;

    // 分句对齐编辑模式：抓到边界手柄就开始拖边界；
    // 句中按下 / 点击统一留到 pointerup 处理（区分"点句试听"和"框选"）。
    // 此模式下不发起框选拖拽，避免轻轻一动就把整句选区覆盖掉。
    if (segmentEditor) {
      if (segments?.length) {
        const boundary = boundaryAtPointer(event.clientX);
        if (boundary !== null && onBoundaryChange) {
          (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
          setDraggingBoundary(boundary);
          return;
        }
      }
      if (!onSelect) return;
    }

    if (!onSelect) {
      onSeek?.(positionToMs(event.clientX));
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const ms = positionToMs(event.clientX);
    setDragStart(ms);
    setDragCurrent(ms);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingBoundary !== null) {
      const ms = positionToMs(event.clientX);
      const current = segments ?? [];
      const left = current[draggingBoundary];
      const right = current[draggingBoundary + 1];
      if (left && right) {
        // 夹在左右两句各自留出的最小句长之间 —— 任何一句都不能被拖没
        const clamped = Math.min(
          right.endMs - MIN_SEGMENT_MS,
          Math.max(left.startMs + MIN_SEGMENT_MS, ms),
        );
        onBoundaryChange?.(draggingBoundary, clamped);
      }
      return;
    }
    if (dragStart === null) return;
    setDragCurrent(positionToMs(event.clientX));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingBoundary !== null) {
      setDraggingBoundary(null);
      return;
    }

    // 分句编辑模式：点（而非拖拽）在某句内 -> 定位到点击处并通知父级播放该句
    if (segmentEditor && dragStart === null) {
      const ms = positionToMs(event.clientX);
      onSeek?.(ms);
      const index = segmentIndexAt(event.clientX);
      if (index !== null) onSegmentClick?.(index);
      return;
    }

    if (dragStart === null || !onSelect) {
      onSeek?.(positionToMs(event.clientX));
      return;
    }
    const end = positionToMs(event.clientX);
    const start = Math.min(dragStart, end);
    const finish = Math.max(dragStart, end);
    setDragStart(null);
    setDragCurrent(null);

    // 点一下（而非拖拽）视为定位；分句编辑模式下顺带高亮被点中的那句
    if (finish - start < 300) {
      onSeek?.(start);
      if (segmentEditor) {
        const index = segmentIndexAt(event.clientX);
        if (index !== null) onSegmentClick?.(index);
      }
      onSelect(null);
      return;
    }
    onSelect({ startMs: start, endMs: finish });
  };

  const pendingSelection =
    dragStart !== null && dragCurrent !== null
      ? { startMs: Math.min(dragStart, dragCurrent), endMs: Math.max(dragStart, dragCurrent) }
      : null;

  const activeSelection = pendingSelection ?? selection ?? null;

  if (!normalized) {
    return (
      <div className="froa-wave">
        <div className="froa-wave-empty">{emptyHint}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`froa-wave${segmentEditor ? ' froa-wave-segments-mode' : ''}`}
      style={{ height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="slider"
      aria-label={segmentEditor ? '分句时间轴波形（拖动竖柄调整句间边界）' : '音频波形'}
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={playheadMs ?? 0}
      tabIndex={0}
    >
      <canvas ref={canvasRef} style={{ height }} />

      {/* 分句区间：每句一条浅色底，正在播放的那句用主色高亮 */}
      {segmentEditor &&
        durationMs > 0 &&
        segments?.map((segment, index) => (
          <div
            key={`${segment.startMs}-${index}`}
            className={`froa-wave-segment${index === activeSegmentIndex ? ' is-active' : ''}`}
            style={{
              left: `${(segment.startMs / durationMs) * 100}%`,
              width: `${((segment.endMs - segment.startMs) / durationMs) * 100}%`,
            }}
          />
        ))}

      {durationMs > 0 && activeSelection && (
        <div
          className="froa-wave-selection"
          style={{
            left: `${(activeSelection.startMs / durationMs) * 100}%`,
            width: `${((activeSelection.endMs - activeSelection.startMs) / durationMs) * 100}%`,
          }}
        />
      )}

      {/* 句间可拖手柄（首尾两条音频边界固定不画；只读时不渲染） */}
      {segmentEditor &&
        onBoundaryChange &&
        durationMs > 0 &&
        segments?.slice(0, -1).map((segment, index) => (
          <div
            key={`handle-${index}`}
            className={`froa-wave-handle${draggingBoundary === index ? ' is-dragging' : ''}`}
            style={{ left: `${(segment.endMs / durationMs) * 100}%` }}
            title="拖动调整这句的结束位置"
          />
        ))}

      {durationMs > 0 && playheadMs !== undefined && (
        <div
          className="froa-wave-playhead"
          style={{ left: `${(Math.min(playheadMs, durationMs) / durationMs) * 100}%` }}
        />
      )}
    </div>
  );
}

export function formatMs(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}
