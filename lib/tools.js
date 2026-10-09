/**
 * dsh-plugin-git — Agent tools.
 *
 * Every tool here delegates to the same handler the browser panel calls over
 * RPC (`rpc.methods[...]`), so there is exactly one implementation of "what is
 * a file's history" and one failure message. This is the "one operation, two
 * entry points" rule: the UI and the model must never be able to disagree about
 * what the repository says.
 *
 * Read tools are unrestricted. Write tools are NOT registered at all by
 * default — a model that can silently `checkout` or `discard` is a foot-gun,
 * and the panel's explicit confirmation cannot be reproduced in a tool call.
 * `registerWriteTools` opts in for users who want it, and even then every write
 * tool demands a `confirm` argument so the model must state its intent.
 */
import { isSafePath, riskOf } from './git/write.js'

/** Tool definitions are data; the executor closes over the RPC dispatcher. */
export function createTools(deps) {
  const { rpc, logger } = deps

  /**
   * Run one RPC method and translate its envelope into a tool result.
   *
   * @param method - the RPC method name.
   * @param payload - its payload.
   * @param exec - the tool run context (for cancellation).
   * @returns `{ value }` for the tool's output, or a thrown Error.
   */
  const call = async (method, payload, exec) => {
    const envelope = await rpc.call(method, payload, exec?.signal)
    if (envelope.ok !== true) {
      throw new Error(envelope.error?.message ?? 'git 调用失败')
    }
    return envelope.value
  }

  /**
   * Build one read tool.
   *
   * @param spec - `{ name, description, parameters, run, render }`.
   * @returns a ToolDefinition.
   */
  const readTool = (spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: spec.render(value) }],
    },
    async execute(args, exec) {
      const value = await call(spec.method ?? spec.name.replace(/^git_/, ''), args ?? {}, exec)
      return value
    },
  })

  const tools = [
    readTool({
      name: 'git_repos',
      description:
        '列出可用的 git 仓库以及每个仓库的当前分支、暂存/未暂存文件数。在调用其它 git_* 工具前可先用它确认有哪些仓库，以及 git 是否可用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '可选：指定一个目录来探测它是否位于某个仓库内。' },
        },
        additionalProperties: false,
      },
      method: 'repos',
      render: (value) => {
        if (value?.repos === undefined) return '没有可用仓库'
        if (value.repos.length === 0) {
          return `git：${value.gitPath ?? '未找到'}\n没有检测到 git 仓库。`
        }
        return [
          `git：${value.gitPath}`,
          ...value.repos.map((repo) => `- ${repo.root}${repo.version !== null ? ` (${repo.version})` : ''}`),
        ].join('\n')
      },
    }),

    readTool({
      name: 'git_status',
      description:
        '读取工作区状态：当前分支、领先/落后上游的提交数，以及每个改动文件的路径、暂存状态与增删行数。',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: '仓库根目录；省略则使用当前会话的工作目录。' },
          force: { type: 'boolean', description: '为 true 时绕过缓存重新读取。' },
        },
        additionalProperties: false,
      },
      method: 'status',
      render: (value) => {
        const lines = [
          `仓库：${value.repo?.root ?? '?'}`,
          `分支：${value.branch?.head ?? '?'}${value.branch?.upstream ? ` → ${value.branch.upstream}` : ''}` +
            (value.branch?.ahead || value.branch?.behind ? ` (领先 ${value.branch.ahead} / 落后 ${value.branch.behind})` : ''),
          `改动文件 ${value.total} 个：`,
        ]
        for (const file of value.files ?? []) {
          const counts = file.added === null && file.deleted === null ? '' : ` +${file.added ?? 0} -${file.deleted ?? 0}`
          const staged = file.staged ? '[已暂存]' : '[未暂存]'
          lines.push(`  ${staged} ${file.kind === 'untracked' ? '[新文件]' : ''} ${file.path}${counts}`)
        }
        return lines.join('\n')
      },
    }),

    readTool({
      name: 'git_log',
      description:
        '查询提交列表。支持按路径（含重命名追踪）、作者、提交信息关键字、内容增删（pickaxe）过滤，也可只看某个 ref。返回 sha、作者、时间、标题与改动文件。',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: '仓库根目录。' },
          ref: { type: 'string', description: '起点 ref，例如分支名或 sha；省略为 HEAD。' },
          path: { type: 'string', description: '只看该路径的历史（自动加 --follow 追踪重命名）。' },
          author: { type: 'string', description: '按作者过滤（子串匹配）。' },
          grep: { type: 'string', description: '按提交信息过滤（忽略大小写）。' },
          pickaxe: { type: 'string', description: '找出增删了该字符串的提交（git log -S）。' },
          pickaxeRegex: { type: 'string', description: '找出 diff 内容匹配该正则的提交（git log -G）。' },
          since: { type: 'string', description: '起始时间，例如 "2 weeks ago" 或 2024-01-01。' },
          until: { type: 'string', description: '结束时间。' },
          limit: { type: 'integer', description: '最多返回多少条，默认 20，上限 500。' },
          noMerges: { type: 'boolean', description: '排除合并提交。' },
        },
        additionalProperties: false,
      },
      method: 'commits',
      render: (value) => {
        const commits = value?.commits ?? []
        if (commits.length === 0) return '没有匹配的提交'
        return commits
          .map((commit) => {
            const files = (commit.files ?? []).map((f) => `${f.status}${f.path}`).join(', ')
            return `${commit.shortSha} ${commit.authorDate === null ? '' : new Date(commit.authorDate * 1000).toISOString().slice(0, 10)} ${commit.author}  ${commit.subject}${files === '' ? '' : `\n    ${files}`}`
          })
          .join('\n')
      },
    }),

    readTool({
      name: 'git_show',
      description: '读取单个提交的完整信息：作者、时间、完整提交信息、父提交，以及每个改动文件的增删行数。',
      parameters: {
        type: 'object',
        properties: {
          sha: { type: 'string', description: '提交 sha（完整或缩写均可）。' },
          root: { type: 'string', description: '仓库根目录。' },
        },
        required: ['sha'],
        additionalProperties: false,
      },
      method: 'commit',
      render: (value) => {
        const lines = [
          `commit ${value.sha}`,
          `作者：${value.author} <${value.authorEmail}>`,
          `时间：${value.authorDate === null ? '?' : new Date(value.authorDate * 1000).toISOString()}`,
          `父提交：${(value.parents ?? []).map((p) => p.slice(0, 7)).join(' ') || '（根提交）'}`,
          '',
          value.message,
          '',
          '改动文件：',
        ]
        for (const file of value.files ?? []) {
          lines.push(`  ${file.added ?? '-'} +  ${file.deleted ?? '-'} -  ${file.path}`)
        }
        return lines.join('\n')
      },
    }),

    readTool({
      name: 'git_diff',
      description:
        '读取差异。可以不传参数看工作区改动，也可用 from/to 比较两个 ref，或用 staged 只看已暂存内容，或用 path 限定单个文件。',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: '仓库根目录。' },
          from: { type: 'string', description: '起始 ref。' },
          to: { type: 'string', description: '结束 ref；省略且未给 from 时比较工作区与 HEAD。' },
          path: { type: 'string', description: '只比较该文件。' },
          staged: { type: 'boolean', description: '为 true 时比较暂存区与 HEAD。' },
          contextLines: { type: 'integer', description: '上下文行数，默认 3。' },
        },
        additionalProperties: false,
      },
      method: 'diff',
      render: (value) => {
        if (typeof value?.text !== 'string' || value.text.trim() === '') return '没有差异'
        return value.text.length > 40_000 ? `${value.text.slice(0, 40_000)}\n…（已截断）` : value.text
      },
    }),

    readTool({
      name: 'git_blame',
      description:
        '逐行归属：返回指定文件每一行由哪个提交、哪位作者、什么时间改的。可只查某个区间（大文件强烈建议给 startLine/endLine）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径（相对仓库根）。' },
          root: { type: 'string', description: '仓库根目录。' },
          rev: { type: 'string', description: '在指定 revision 上 blame；省略为工作区。' },
          startLine: { type: 'integer', description: '起始行（含），从 1 开始。' },
          endLine: { type: 'integer', description: '结束行（含）。' },
          ignoreWhitespace: { type: 'boolean', description: '忽略纯空白改动。' },
        },
        required: ['path'],
        additionalProperties: false,
      },
      method: 'blame',
      render: (value) => {
        const lines = value?.lines ?? []
        if (lines.length === 0) return '没有 blame 结果'
        const head = `文件：${value.path}@${value.rev}，共 ${value.fileLines} 行${value.cacheable === false ? '（超出缓存上限）' : ''}`
        const body = lines
          .map((line) => {
            const date = line.authorTime === null ? '' : new Date(line.authorTime * 1000).toISOString().slice(0, 10)
            return `${String(line.line).padStart(5)}  ${line.sha.slice(0, 7)}  ${date}  ${line.author}  ${line.summary}`
          })
          .join('\n')
        return `${head}\n${body}`
      },
    }),

    readTool({
      name: 'git_line_history',
      description:
        '追踪某一行的改动历史：这条内容依次被哪些提交改过、每次改动前的行号与路径是什么（路径变化即重命名）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径。' },
          line: { type: 'integer', description: '行号，从 1 开始。' },
          root: { type: 'string', description: '仓库根目录。' },
          maxDepth: { type: 'integer', description: '最多回溯多少步，默认 30。' },
        },
        required: ['path', 'line'],
        additionalProperties: false,
      },
      method: 'lineHistory',
      render: (value) => {
        const entries = value?.entries ?? []
        if (entries.length === 0) return '没有找到该行的历史'
        return entries
          .map((entry, index) => {
            const date = entry.authorTime === null ? '' : new Date(entry.authorTime * 1000).toISOString().slice(0, 10)
            return `${index + 1}. ${entry.sha.slice(0, 7)}  ${date}  ${entry.author}  ${entry.path}:${entry.line}  ${entry.summary}`
          })
          .join('\n')
      },
    }),

    readTool({
      name: 'git_commit_graph',
      description: '读取提交图数据：每个提交所在泳道、父提交连线、ref 装饰，以及泳道总数。用于理解分支与合并结构。',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: '仓库根目录。' },
          limit: { type: 'integer', description: '最多返回多少行，默认 100，上限 2000。' },
          path: { type: 'string', description: '只看该路径的图。' },
          all: { type: 'boolean', description: '包含所有分支，默认 true。' },
        },
        additionalProperties: false,
      },
      method: 'commitGraph',
      render: (value) => {
        const rows = value?.rows ?? []
        if (rows.length === 0) return '没有提交'
        return [
          `泳道数：${value.laneCount}`,
          ...rows.map((row) => {
            const tips = row.tips.length > 0 ? ` (${row.tips.join(', ')})` : ''
            const pad = '│ '.repeat(Math.max(row.lane, 0))
            const mark = row.parents.length > 1 ? 'M' : 'o'
            return `${pad}${mark} ${row.shortSha} ${row.subject}${tips}`
          }),
        ].join('\n')
      },
    }),

    readTool({
      name: 'git_ai_commit_message',
      description:
        '读取当前已暂存的改动（没有暂存改动时读工作区改动），调用 DSH 的模型生成一条符合项目风格的提交信息。只生成文本，不会提交任何东西。',
      parameters: {
        type: 'object',
        properties: {
          root: { type: 'string', description: '仓库根目录。' },
          hint: { type: 'string', description: '可选：告诉模型这次改动的意图。' },
        },
        additionalProperties: false,
      },
      method: 'ai.commitMessage',
      render: (value) => {
        if (value?.available === false) return `模型不可用：${value.message}`
        if (value?.empty === true) return '没有可生成提交信息的改动'
        return value?.message ?? '（模型没有返回内容）'
      },
    }),

    readTool({
      name: 'git_ai_explain_commit',
      description: '让 DSH 的模型解释某次提交做了什么、为什么可能这样做、影响面在哪。只读，不会改动任何东西。',
      parameters: {
        type: 'object',
        properties: {
          sha: { type: 'string', description: '提交 sha。' },
          root: { type: 'string', description: '仓库根目录。' },
        },
        required: ['sha'],
        additionalProperties: false,
      },
      method: 'ai.explainCommit',
      render: (value) => {
        if (value?.available === false) return `模型不可用：${value.message}`
        return value?.text ?? '（模型没有返回内容）'
      },
    }),
  ]

  return tools
}

/**
 * Build the opt-in write tools.
 *
 * A write tool's `confirm` argument is required and must be literally `true`:
 * the model has to state that the user asked for the mutation. It is not a
 * substitute for a human confirmation dialog — it is a speed bump that makes
 * "the model decided to discard your work" impossible by accident.
 *
 * @param deps - `{ rpc }`.
 * @returns write tool definitions.
 */
export function createWriteTools(deps) {
  const { rpc } = deps
  const names = [
    ['git_stage', 'write.stage', '暂存文件。paths 省略时暂存全部改动。', { paths: { type: 'array', items: { type: 'string' } } }],
    ['git_unstage', 'write.unstage', '取消暂存。paths 省略时取消全部。', { paths: { type: 'array', items: { type: 'string' } } }],
    ['git_commit', 'write.commit', '创建一次提交。', { message: { type: 'string' } }, ['message']],
  ]

  return names.map(([name, method, description, extra, required]) => ({
    name,
    description: `${description} 需要 confirm: true 才会真正执行。`,
    parameters: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '仓库根目录。' },
        ...extra,
        confirm: { type: 'boolean', description: '必须显式传 true，表示用户已同意执行该写操作。' },
      },
      ...(required === undefined ? {} : { required: [...required, 'confirm'] }),
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: value?.message ?? '完成' }],
    },
    async execute(args, exec) {
      const payload = { ...(args ?? {}) }
      if (payload.confirm !== true) {
        throw new Error(`拒绝执行 ${name}：需要 confirm: true`)
      }
      for (const path of payload.paths ?? []) {
        if (!isSafePath(path)) throw new Error(`拒绝不安全的路径：${String(path)}`)
      }
      const envelope = await rpc.call(method, payload, exec?.signal)
      if (envelope.ok !== true) throw new Error(envelope.error?.message ?? 'git 写操作失败')
      return envelope.value
    },
    // Surfaced so a host UI can badge the tool; harmless if unused.
    risk: riskOf(method),
  }))
}
