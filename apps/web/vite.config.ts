import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, '');

  return {
    plugins: [react()],
    server: {
      port: Number(env.WEB_DEV_PORT || 5173),
      // 端口被占用时直接报错退出，而不是自动换端口。
      // 否则本机若已有别的项目跑在 5173，你会以为打开的是本项目，其实是别人的页面。
      strictPort: true,
      // 开发期把 API 与 WebSocket 一并代理到后端，前端始终同源，
      // 避免 CORS，以及 <audio> 标签无法自定义请求头的问题
      proxy: {
        '/api': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:4000', changeOrigin: true },
        '/ws': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:4000', ws: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
