import { defineConfig } from 'tsdown'

/**
 * 所有包共用的构建配置：`src/index.ts` → `lib/index.js` + `lib/index.d.ts`。
 *
 * 每个包的 `build` 脚本以本文件为配置、以**包目录**为工作目录运行；
 * `cwd` 显式取 `process.cwd()`，否则 tsdown 会按配置文件所在目录解析入口。
 *
 * `@deepseek-ai/*`（宿主 peer）与 `dsh-git-*`（workspace 内部包）都不打进产物。
 */
export default defineConfig({
  cwd: process.cwd(),
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  sourcemap: true,
  // DSH 按 package.json 的 main/types 解析，所以固定成 .js / .d.ts（而不是 .mjs / .d.mts）
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^dsh-git-/],
  },
})
