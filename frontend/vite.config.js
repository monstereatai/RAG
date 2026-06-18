import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 后端 API 代理，避免开发时跨域
export default defineConfig({
    plugins: [react()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
            },
        },
    },
});
