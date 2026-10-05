import { defineConfig, type ViteUserConfig } from 'vitest/config'
import path from 'path'

// `configFile` is an inline/CLI-level option, not part of Vitest's
// user-config type, so the object needs a targeted `as ViteUserConfig` cast.
// The field itself is kept untouched to avoid any behavior change.
export default defineConfig({
  configFile: false,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    css: false,
  },
} as ViteUserConfig)
