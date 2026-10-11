import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) }

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: 'unit', include: ['src/**/*.test.ts', 'test/unit/**/*.test.ts'] },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
})
