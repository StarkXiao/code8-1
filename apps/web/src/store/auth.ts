import { create } from 'zustand';
import type { UserDto } from '@froa/shared';
import { authApi } from '../api/endpoints';
import { tokenStore } from '../api/client';

interface AuthState {
  user: UserDto | null;
  loading: boolean;
  bootstrap: () => Promise<void>;
  setUser: (user: UserDto | null) => void;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,

  /** 应用启动时用已有令牌换回用户信息；失败则视为未登录 */
  bootstrap: async () => {
    if (!tokenStore.access) {
      set({ user: null, loading: false });
      return;
    }
    try {
      set({ user: await authApi.me(), loading: false });
    } catch {
      tokenStore.clear();
      set({ user: null, loading: false });
    }
  },

  setUser: (user) => set({ user }),

  login: async (email, password) => {
    const { user, tokens } = await authApi.login({ email, password });
    tokenStore.set(tokens);
    set({ user });
  },

  register: async (email, password, displayName) => {
    const { user, tokens } = await authApi.register({ email, password, displayName });
    tokenStore.set(tokens);
    set({ user });
  },

  logout: () => {
    tokenStore.clear();
    set({ user: null });
  },
}));
