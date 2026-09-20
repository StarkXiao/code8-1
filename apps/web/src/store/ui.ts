import { create } from 'zustand';

export type FontScale = 'normal' | 'large' | 'xlarge';

const FONT_KEY = 'froa.fontScale';
const SCALE_VALUES: FontScale[] = ['normal', 'large', 'xlarge'];

interface UiState {
  fontScale: FontScale;
  setFontScale: (scale: FontScale) => void;
}

function applyFontScale(scale: FontScale) {
  document.documentElement.dataset.fontScale = scale;
}

const initial = (localStorage.getItem(FONT_KEY) as FontScale | null) ?? 'normal';
applyFontScale(SCALE_VALUES.includes(initial) ? initial : 'normal');

/**
 * 长者友好：字号三档。
 * 直接用 html 根字号缩放，antd 组件与自定义样式一起变，不需要逐处调样式。
 */
export const useUiStore = create<UiState>((set) => ({
  fontScale: SCALE_VALUES.includes(initial) ? initial : 'normal',
  setFontScale: (scale) => {
    localStorage.setItem(FONT_KEY, scale);
    applyFontScale(scale);
    set({ fontScale: scale });
  },
}));
