import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5199, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as never);
