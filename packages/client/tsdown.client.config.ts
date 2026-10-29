import { defineConfig } from 'tsdown'

/**
 * 客户端 bundle 的构建配置。
 *
 * DSH 的客户端插件不是 ESM，而是 classic script：
 *
 * ```js
 * window.__ModuleLoader__.load({
 *   id: "<包名>",
 *   factory: (require) => { var module = { exports: {} }; ...; return module.exports }
 * })
 * ```
 *
 * 所以这里用 CJS 产物 + banner/footer 包一层，并把宿主 module table 里的模块
 * 全部 external（运行时由 `require` 从宿主取，不能打进产物）。
 */
export default defineConfig({
  cwd: process.cwd(),
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2022',
  dts: false,
  // host 侧构建先跑且带 clean，这里不能清掉它
  clean: false,
  sourcemap: false,
  // 包是 type:module，CJS 产物默认会被命名成 .cjs；DSH 按 exports["./client"] 找的是 lib/client.js
  outExtensions: () => ({ js: '.js' }),
  deps: {
    neverBundle: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/cordis'],
  },
  banner:
    'window.__ModuleLoader__.load({ id: "dsh-git-client", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  footer: 'return module.exports; } });',
})
