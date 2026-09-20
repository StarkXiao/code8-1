import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Space, Tag } from 'antd';
import { AudioOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import { formatMs } from './Waveform';

export interface RecordedAudio {
  blob: Blob;
  durationMs: number;
  peaks: number[] | null;
  filename: string;
}

interface AudioRecorderProps {
  onRecorded: (audio: RecordedAudio) => void;
  onDiscard?: () => void;
  hint?: string;
}

/**
 * 在浏览器里直接录音。
 *
 * 关键技术点：
 * - 分片录制（timeslice），避免长时间录音把内存撑爆；
 * - 停止后用 Web Audio 解码出峰值，随音频一起上传，
 *   这样服务端不需要 ffmpeg 也能画出波形。
 */
export function AudioRecorder({ onRecorded, onDiscard, hint }: AudioRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state === 'recording') recorder.stop();
    };
  }, []);

  const pickMimeType = (): string => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const candidate of candidates) {
      if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
    }
    return '';
  };

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持录音。请改用 Chrome / Edge / Safari，或直接从文件上传音频。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' });
        const durationMs = Date.now() - startedAtRef.current;
        const analysis = await analyzeAudio(blob).catch(() => null);
        const extension = (mimeType || 'audio/webm').includes('mp4') ? 'm4a' : 'webm';
        onRecorded({
          blob,
          // 浏览器解码出来的时长比 wall-clock 更准（录制启动有延迟）
          durationMs: analysis?.durationMs ?? durationMs,
          peaks: analysis?.peaks ?? null,
          filename: `voice-${Date.now()}.${extension}`,
        });
      };

      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start(1000);
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed(Date.now() - startedAtRef.current), 100);
    } catch (caught) {
      setError(
        caught instanceof Error && caught.name === 'NotAllowedError'
          ? '没有拿到麦克风权限。请在浏览器地址栏允许麦克风后重试。'
          : `无法开始录音：${(caught as Error).message}`,
      );
    }
  };

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    recorderRef.current?.stop();
  };

  return (
    <div className="froa-recorder">
      {error && <Alert type="warning" showIcon message={error} style={{ width: '100%' }} />}

      <button
        type="button"
        className={`froa-rec-btn${recording ? ' recording' : ''}`}
        onClick={recording ? stop : start}
        aria-label={recording ? '停止录音' : '开始录音'}
      >
        {recording ? <StopOutlined style={{ fontSize: 30 }} /> : <AudioOutlined style={{ fontSize: 30 }} />}
      </button>

      <div className="froa-timer">{formatMs(elapsed)}</div>

      <Space>
        {recording ? (
          <Button danger size="large" icon={<StopOutlined />} onClick={stop}>
            停止并保存
          </Button>
        ) : (
          <Button type="primary" size="large" icon={<AudioOutlined />} onClick={start}>
            点击开始说话
          </Button>
        )}
        {onDiscard && (
          <Button size="large" icon={<ReloadOutlined />} onClick={onDiscard}>
            重录
          </Button>
        )}
      </Space>

      <Tag color={recording ? 'red' : 'default'}>{recording ? '正在录音…' : '未开始'}</Tag>
      <div className="froa-hint" style={{ textAlign: 'center', maxWidth: 420 }}>
        {hint ?? '录完可以回放核对，再决定要不要保存。原始语音会一直保留，不会被后续整理覆盖。'}
      </div>
    </div>
  );
}

export interface AudioAnalysis {
  peaks: number[];
  durationMs: number;
}

/**
 * 用 Web Audio 解码出音频时长与波形峰值。
 *
 * 时长必须在前端算出来：服务端默认不依赖 ffmpeg，拿不到时长的话
 * 波形就没有时间轴，也就框选不出片段。失败不影响上传 ——
 * 只是没有波形，音频本身照常保存。
 */
export async function analyzeAudio(blob: Blob, buckets = 400): Promise<AudioAnalysis> {
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextCtor();
  try {
    const buffer = await blob.arrayBuffer();
    const audioBuffer = await context.decodeAudioData(buffer.slice(0));
    const channel = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channel.length / buckets));
    const peaks: number[] = [];

    for (let bucket = 0; bucket < buckets; bucket += 1) {
      let max = 0;
      const offset = bucket * blockSize;
      for (let i = 0; i < blockSize; i += 1) {
        const value = Math.abs(channel[offset + i] ?? 0);
        if (value > max) max = value;
      }
      peaks.push(Number(max.toFixed(4)));
    }

    const loudest = Math.max(...peaks, 0.0001);
    return {
      peaks: peaks.map((value) => Number((value / loudest).toFixed(4))),
      durationMs: Math.round(audioBuffer.duration * 1000),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}
