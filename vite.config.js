import { defineConfig } from 'vite';
export default defineConfig({
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  build: { target: 'es2022' },
  preview: { port: 5173 },
});
