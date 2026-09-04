import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';

function wasmDataUrl() {
  return {
    name: 'wasm-data-url',
    enforce: 'pre' as const,
    async load(id: string) {
      const [filePath, query] = id.split('?');
      if (query !== 'base64' || !filePath.endsWith('.wasm')) return null;
      const base64 = (await readFile(filePath)).toString('base64');
      return `export default ${JSON.stringify(`data:application/wasm;base64,${base64}`)};`;
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [wasmDataUrl(), react()],
  worker: {
    plugins: () => [wasmDataUrl()]
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false
  }
});
