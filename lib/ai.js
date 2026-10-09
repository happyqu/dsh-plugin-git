/**
 * dsh-plugin-git — AI assistance over the Host's own model service.
 *
 * These calls use `ctx.llm.stream()` directly, the same way the shipped
 * session-title feature does: they are the plugin's own model calls and never
 * enter the session log. That matters for two reasons — a "write me a commit
 * message" button should not look like a conversation turn, and a large diff
 * should not consume the session's context budget.
 *
 * The provider/model default to the DSH selection rather than a pinned model,
 * because a user who switched their default model expects every feature to
 * follow it. Both can be pinned in the plugin settings.
 */

import { redact } from './git/commandLog.js'

/** Prompt shared by every call, so the plugin's voice is consistent. */
const BASE_SYSTEM = [
  '你是一个严谨的 Git 助手，服务于中文开发者。',
  '你只输出被要求的内容本身，不写解释、不写前言、不写 Markdown 代码围栏。',
  '禁止编造 diff 中不存在的信息。如果改动不足以判断意图，就事论事地描述改了什么。',
].join('\n')

/** Cap on streamed output, guarding against a runaway generation. */
const MAX_TOKENS = 1500

/**
 * Build the LLM facade.
 *
 * @param deps - plugin dependencies.
 * @returns an object with the generation methods, or undefined when no `llm`
 *   service is composed in this profile.
 */
export function createLlm(deps) {
  const { getLlm, getDefaultSelection, getConfig, logger } = deps

  /**
   * Run one streaming completion and collect its text.
   *
   * @param input - `{ system, user, signal, maxTokens }`.
   * @returns the generated text, trimmed.
   */
  const complete = async (input) => {
    const llm = getLlm?.()
    if (llm === undefined || llm === null) {
      throw new Error('当前 profile 没有可用的模型服务')
    }
    const config = getConfig()
    if (config.aiEnabled === false) throw new Error('AI 功能已在插件设置中关闭')
    let provider = config.aiProvider
    let model = config.aiModel
    if (provider === '' || model === '') {
      // Follow the DSH default model unless both are pinned.
      const selection = getDefaultSelection?.()
      provider = provider === '' ? selection?.provider ?? '' : provider
      model = model === '' ? selection?.model ?? '' : model
    }
    if (provider === '' || model === '') {
      throw new Error('没有可用的默认模型，请在设置里指定 provider 与 model')
    }

    let text = ''
    const stream = llm.stream({
      provider,
      model,
      system: input.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: redact(input.user) }] }],
      maxTokens: input.maxTokens ?? MAX_TOKENS,
      signal: input.signal,
    })
    for await (const chunk of stream) {
      // The chunk vocabulary differs per adapter; accept the text-bearing
      // shapes and ignore the rest rather than throwing on an unknown kind.
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' || chunk.type === 'text_delta') {
        text += String(chunk.text ?? chunk.delta ?? '')
      } else if (chunk.type === 'text' && typeof chunk.text === 'string') {
        text += chunk.text
      } else if (typeof chunk.text === 'string' && chunk.type === undefined) {
        text += chunk.text
      }
    }
    return text.trim()
  }

  return {
    /**
     * Whether generation can actually be attempted right now.
     *
     * A truthy facade is not the same as a usable model: `createLlm` always
     * returns an object, so every caller that tested `llm === undefined` got
     * "yes" and then failed deep inside the first generation instead of
     * disabling the button. This asks the real questions — is the service
     * composed, and do we know which model to call?
     *
     * @returns `{ available, reason }`.
     */
    available() {
      if (getLlm?.() === undefined || getLlm?.() === null) {
        return { available: false, reason: '当前 profile 没有可用的模型服务' }
      }
      const config = getConfig()
      if (config.aiEnabled === false) {
        return { available: false, reason: 'AI 功能已在插件设置中关闭' }
      }
      if (config.aiProvider !== '' && config.aiModel !== '') return { available: true, reason: '' }
      const selection = getDefaultSelection?.()
      if (selection?.provider && selection?.model) return { available: true, reason: '' }
      return { available: false, reason: '没有可用的默认模型，请在设置里指定 provider 与 model' }
    },

    /**
     * Draft a commit message from a diff.
     * @param input - `{ diff, files, recentSubjects, hint, signal }`.
     * @returns the message.
     */
    async generateCommitMessage(input) {
      const user = [
        '根据下面的 git diff 写一条提交信息。',
        '要求：第一行是 Conventional Commits 风格的标题（feat/fix/docs/refactor/test/chore/perf/build/ci），',
        '用中文，不超过 50 个字符，不加句号。如果改动确实不止一件事，可在空行后补 2~4 条以 "- " 开头的要点。',
        input.recentSubjects.length > 0
          ? `\n最近的历史标题（保持风格一致，但不要照抄）：\n${input.recentSubjects.slice(0, 10).map((s) => `- ${s}`).join('\n')}`
          : '',
        input.hint ? `\n用户补充的意图：${input.hint}` : '',
        `\n改动的文件：\n${input.files.join('\n')}`,
        `\n完整 diff：\n${input.diff}`,
      ]
        .filter((part) => part !== '')
        .join('\n')

      try {
        return await complete({ system: BASE_SYSTEM, user, signal: input.signal })
      } catch (error) {
        logger?.warn?.(`[git] commit message generation failed: ${redact(String(error))}`)
        throw error
      }
    },

    /**
     * Explain a commit's change.
     * @param input - `{ subject, message, author, date, diff, signal }`.
     * @returns the explanation.
     */
    async explainCommit(input) {
      const user = [
        `请解释这次提交做了什么，以及为什么可能这样做。`,
        `\n提交标题：${input.subject}`,
        input.message && input.message !== input.subject ? `\n提交正文：\n${input.message}` : '',
        `\n改动：\n${input.diff}`,
        `\n输出结构：先用一句话概括，再用 2~5 条要点说明具体改了什么、可能的影响面。`,
      ]
        .filter((part) => part !== '')
        .join('\n')
      return complete({ system: BASE_SYSTEM, user, signal: input.signal })
    },

    /**
     * Summarize a set of changes.
     * @param input - `{ diff, files, signal }`.
     * @returns the summary.
     */
    async summarizeDiff(input) {
      const user = [
        '请总结下面这组改动，让一个没看过代码的人也能判断要不要仔细审查。',
        `\n改动的文件：\n${input.files.join('\n')}`,
        `\n完整 diff：\n${input.diff}`,
        `\n输出结构：一句话总体判断；然后按「行为变化」「风险点」「建议关注的文件」三节给出要点。`,
      ].join('\n')
      return complete({ system: BASE_SYSTEM, user, signal: input.signal })
    },
  }
}
