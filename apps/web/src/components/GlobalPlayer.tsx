import { useEffect, useRef } from 'react';
import { Button } from 'antd';
import { CloseOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { usePlayerStore } from '../store/player';
import { formatMs } from './Waveform';

/**
 * 全局唯一播放器。
 *
 * 所有"听原声"入口都调用 usePlayerStore.play()，
 * 由这里统一控制唯一的 <audio> 元素 —— 保证页面切换、弹窗打开都不会出现两个声音。
 */
export function GlobalPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const request = usePlayerStore((s) => s.request);
  const playing = usePlayerStore((s) => s.playing);
  const currentMs = usePlayerStore((s) => s.currentMs);
  const seekNonce = usePlayerStore((s) => s.seekNonce);
  const setPlaying = usePlayerStore((s) => s.setPlaying);
  const setCurrentMs = usePlayerStore((s) => s.setCurrentMs);
  const stop = usePlayerStore((s) => s.stop);

  // 显式定位请求（在波形上点某句）：只移动 currentTime，不打断当前播放 / 暂停状态
  useEffect(() => {
    if (!seekNonce) return;
    const audio = audioRef.current;
    if (!audio || !request) return;
    const apply = () => {
      const seconds = currentMs / 1000;
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(seconds, Math.max(0, audio.duration - 0.05));
      }
    };
    if (audio.readyState >= 1) apply();
    else audio.addEventListener('loadedmetadata', apply, { once: true });
  }, [seekNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !request) return;

    audio.src = request.src;

    const handleTimeUpdate = () => {
      const ms = audio.currentTime * 1000;
      setCurrentMs(ms);
      if (request.endMs !== undefined && ms >= request.endMs) {
        audio.pause();
        setPlaying(false);
      }
    };
    const handleEnded = () => setPlaying(false);
    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);

    // 定位与播放必须等元数据就绪：在此之前设置 currentTime 会被忽略甚至抛错，
    // 那样"点一下回到那句话"就 silently 失效了。
    const startPlayback = () => {
      const startSeconds = (request.startMs ?? 0) / 1000;
      if (startSeconds > 0 && Number.isFinite(audio.duration)) {
        audio.currentTime = Math.min(startSeconds, Math.max(0, audio.duration - 0.05));
      }
      void audio.play().catch(() => setPlaying(false));
    };

    if (audio.readyState >= 1) startPlayback();
    else audio.addEventListener('loadedmetadata', startPlayback, { once: true });

    return () => {
      // 必须移除：快速连续切片段时，上一次残留的监听器会在新音频上按旧位置定位
      audio.removeEventListener('loadedmetadata', startPlayback);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
    };
  }, [request, setCurrentMs, setPlaying]);

  useEffect(() => {
    document.body.classList.toggle('has-player', Boolean(request));
    return () => document.body.classList.remove('has-player');
  }, [request]);

  if (!request) return <audio ref={audioRef} preload="metadata" />;

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => setPlaying(false));
    else audio.pause();
  };

  const seek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const ratio = Number(event.target.value) / 1000;
    const start = request.startMs ?? 0;
    const end = request.endMs ?? (Math.round((audio.duration || 0) * 1000) || start);
    audio.currentTime = (start + (end - start) * ratio) / 1000;
  };

  const start = request.startMs ?? 0;
  const end = request.endMs ?? Math.max(start, currentMs);
  const progress = end > start ? Math.min(1, Math.max(0, (currentMs - start) / (end - start))) : 0;

  return (
    <div className="froa-player">
      <audio ref={audioRef} preload="metadata" />
      <Button
        type="text"
        size="large"
        icon={
          playing ? (
            <PauseCircleOutlined style={{ fontSize: 30, color: '#8c4a24' }} />
          ) : (
            <PlayCircleOutlined style={{ fontSize: 30, color: '#8c4a24' }} />
          )
        }
        onClick={toggle}
        aria-label={playing ? '暂停' : '播放'}
      />

      <div className="froa-player-label">
        <div style={{ fontWeight: 600 }}>{request.label ?? '原始语音'}</div>
        <div style={{ color: '#7a6f64', fontSize: '0.85rem' }}>
          {formatMs(currentMs)}
          {request.endMs !== undefined ? ` / ${formatMs(request.endMs)}` : ''}
          {request.startMs ? `（片段起点 ${formatMs(request.startMs)}）` : ''}
        </div>
      </div>

      {request.endMs !== undefined && (
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={seek}
          style={{ flex: 1, minWidth: 140 }}
          aria-label="播放进度"
        />
      )}

      <Button type="text" icon={<CloseOutlined />} onClick={stop} aria-label="关闭播放器" />
    </div>
  );
}
