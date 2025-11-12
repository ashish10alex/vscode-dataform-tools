import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: './webviews/dependancy_graph/index.tsx',
      output: {
        entryFileNames: 'dependancy_graph.js',
        format: 'iife',
      },
    },
    sourcemap: true,
    // watch: {}
  },
  css: {
    postcss: './postcss.config.js'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './webviews/dependancy_graph')
    }
  }
});
