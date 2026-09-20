import { create } from 'zustand';

export interface PlayRequest {
  audioId: string;
  src: string;
  /** 需要播放的区间；不传表示整段 */
  startMs?: number;
  endMs?: number;
  label?: string;
  /** 同一时刻只允许一个播放器，切换音频时非 0 表示需要重新定位 */
  nonce: number;
}

interface PlayerState {
  request: PlayRequest | null;
  playing: boolean;
  currentMs: number;
  play: (request: Omit<PlayRequest, 'nonce'>) => void;
  stop: () => void;
  setPlaying: (playing: boolean) => void;
  setCurrentMs: (ms: number) => void;
}

/**
 * 全局单例播放器状态。
 *
 * 做成全局的原因：整理规格时需要一边听原声一边填表，
 * 页面切换或弹窗打开都不能中断播放。实际的 <audio> 元素只有一个（见 GlobalPlayer）。
 */
export const usePlayerStore = create<PlayerState>((set) => ({
  request: null,
  playing: false,
  currentMs: 0,

  play: (request) => set({ request: { ...request, nonce: Date.now() }, playing: true, currentMs: request.startMs ?? 0 }),
  stop: () => set({ request: null, playing: false, currentMs: 0 }),
  setPlaying: (playing) => set({ playing }),
  setCurrentMs: (currentMs) => set({ currentMs }),
}));
