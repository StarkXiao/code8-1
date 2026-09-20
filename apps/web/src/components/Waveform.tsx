import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface WaveformSelection {
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
}

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
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragCurrent, setDragCurrent] = useState<number | null>(null);

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

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!normalized) return;
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
    if (dragStart === null) return;
    setDragCurrent(positionToMs(event.clientX));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart === null || !onSelect) {
      onSeek?.(positionToMs(event.clientX));
      return;
    }
    const end = positionToMs(event.clientX);
    const start = Math.min(dragStart, end);
    const finish = Math.max(dragStart, end);
    setDragStart(null);
    setDragCurrent(null);

    // 点一下（而非拖拽）视为定位，不产生片段
    if (finish - start < 300) {
      onSeek?.(start);
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
      className="froa-wave"
      style={{ height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      role="slider"
      aria-label="音频波形"
      aria-valuemin={0}
      aria-valuemax={durationMs}
      aria-valuenow={playheadMs ?? 0}
      tabIndex={0}
    >
      <canvas ref={canvasRef} style={{ height }} />
      {durationMs > 0 && activeSelection && (
        <div
          className="froa-wave-selection"
          style={{
            left: `${(activeSelection.startMs / durationMs) * 100}%`,
            width: `${((activeSelection.endMs - activeSelection.startMs) / durationMs) * 100}%`,
          }}
        />
      )}
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
