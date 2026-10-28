import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Library build of the Ledger design system for /design-sync (dist-ds/).
// The app build (vite.config.ts) is untouched.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    outDir: 'dist-ds',
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, 'src/ds/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/, /^@base-ui\/react/, 'clsx', 'tailwind-merge', 'tesseract.js'],
    },
  },
})
