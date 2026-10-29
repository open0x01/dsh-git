/**
 * 工具输出里复用的 schema 片段。
 *
 * 这些形状同时被 `output.schema`（模型可见的规范值）和 `presentationMeta` 使用，
 * 集中一处避免各工具漂移。
 *
 * @module dsh-git-tool-git/schema
 */

/** 可空字符串（DSH 的 schema 子集没有 nullable 关键字，用 oneOf 表达）。 */
export const nullableString = {
  oneOf: [{ type: 'string' }, { type: 'null' }],
} as const

/** 单个文件变更。 */
export const fileChangeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true, description: '相对仓库根的路径' },
    oldPath: { type: 'string', description: '重命名/复制的来源路径' },
    status: {
      type: 'string',
      required: true,
      enum: ['added', 'modified', 'deleted', 'renamed', 'copied', 'unmerged', 'untracked'],
    },
    staged: { type: 'boolean', required: true, description: '是否已进入索引' },
    additions: { type: 'integer', description: '新增行数' },
    deletions: { type: 'integer', description: '删除行数' },
    binary: { type: 'boolean', required: true },
  },
} as const

/** 文件变更数组。 */
export const fileChangesSchema = {
  type: 'array',
  items: fileChangeSchema,
} as const

/** 一条提交。 */
export const commitSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sha: { type: 'string', required: true },
    shortSha: { type: 'string', required: true },
    author: { type: 'string', required: true },
    authorEmail: { type: 'string', required: true },
    date: { type: 'string', required: true, description: 'ISO 8601' },
    subject: { type: 'string', required: true },
    parents: { type: 'array', required: true, items: { type: 'string' } },
    graph: { type: 'string', description: '提交图前缀' },
  },
} as const

/** `repoDir` 参数（所有工具共有）。 */
export const repoDirParam = {
  type: 'string',
  description: '仓库目录；省略时用会话当前工作目录',
} as const

/** `paths` 参数。 */
export const pathsParam = {
  type: 'array',
  description: '只看这些路径（相对仓库根或绝对路径）',
  items: { type: 'string' },
} as const
