import { defineConfig } from 'vite';
export default defineConfig({ server: { proxy: { '/api': 'http://localhost:8080', '/health': 'http://localhost:8080' } } });
