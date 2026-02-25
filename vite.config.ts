import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        dependancy_graph: './webviews/dependancy_graph/index.tsx',
        preview_compiled: './webviews/preview_compiled/index.tsx',
        query_results: './webviews/query_results/index.tsx'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
        format: 'es', 
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
      '@': path.resolve(__dirname, './webviews')
    }
  }
});
