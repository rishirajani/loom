/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Two projects so the environment is decided by config, not by a
    // per-file comment that breaks silently if anything precedes it.
    // Pure-logic suites run in fast 'node'; anything needing the DOM
    // (File/FileReader for CSV parsing) runs in happy-dom.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/csvParser.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['src/**/csvParser.test.ts'],
        },
      },
    ],
  },
})
