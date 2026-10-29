import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const coreEntry = fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // 测试直接跑源码，避免「改了 src 忘了 build」导致测试测的是旧产物
      'dsh-git-core': coreEntry,
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 集成测试会起 git 子进程，串行更好排查
    fileParallelism: false,
  },
})
