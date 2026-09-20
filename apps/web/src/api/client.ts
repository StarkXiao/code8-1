import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import type { ApiErrorBody, AuthTokens } from '@froa/shared';

const ACCESS_KEY = 'froa.accessToken';
const REFRESH_KEY = 'froa.refreshToken';

export const tokenStore = {
  get access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },
  get refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },
  set(tokens: AuthTokens) {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api = axios.create({ baseURL: '/api', timeout: 30_000 });

api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** 令牌过期时只刷新一次，其余请求排队等待结果，避免并发的刷新风暴 */
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStore.refresh;
  if (!refreshToken) return null;
  try {
    const response = await axios.post<{ data: { tokens: AuthTokens } }>('/api/auth/refresh', {
      refreshToken,
    });
    tokenStore.set(response.data.data.tokens);
    return response.data.data.tokens.accessToken;
  } catch {
    tokenStore.clear();
    return null;
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorBody>) => {
    const original = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const code = error.response?.data?.error?.code;

    const shouldRefresh =
      error.response?.status === 401 &&
      !original?._retried &&
      code !== 'AUTH_INVALID_CREDENTIALS' &&
      Boolean(tokenStore.refresh);

    if (shouldRefresh && original) {
      original._retried = true;
      refreshPromise = refreshPromise ?? refreshAccessToken();
      const token = await refreshPromise;
      refreshPromise = null;

      if (token) {
        original.headers = { ...(original.headers ?? {}), Authorization: `Bearer ${token}` };
        return api.request(original);
      }
      // 刷新失败：回到登录页
      if (!location.pathname.startsWith('/login')) location.assign('/login');
    }

    return Promise.reject(error);
  },
);

/** 把后端的统一错误体翻译成一句可直接展示的话 */
export function errorMessage(error: unknown): string {
  const axiosError = error as AxiosError<ApiErrorBody>;
  const body = axiosError?.response?.data;
  if (body?.error) {
    const details = body.error.details;
    if (Array.isArray(details) && details.length) {
      const first = details[0] as { message?: string; field?: string };
      if (first?.message) return `${body.error.message}：${first.message}`;
    }
    return body.error.message;
  }
  if (axiosError?.message) return axiosError.message;
  return '请求失败，请稍后重试';
}

/** 后端返回的字段级校验错误，用于映射到表单 */
export function fieldErrors(error: unknown): { path: string; message: string }[] {
  const axiosError = error as AxiosError<ApiErrorBody>;
  const details = axiosError?.response?.data?.error?.details;
  if (!Array.isArray(details)) return [];
  return details
    .map((item) => {
      const entry = item as { path?: string; field?: string; message?: string };
      return {
        path: entry.path ?? entry.field ?? '',
        message: entry.message ?? '',
      };
    })
    .filter((item) => item.path);
}
