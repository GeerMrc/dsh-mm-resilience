/**
 * Auxiliary single-image describe channel over `ctx.llm.stream`.
 *
 * Bounded worker pool, per-call timeout, and a HARD total budget (a batch
 * deadline controller aborts in-flight calls, so the worst-case pre-step
 * latency bound is the budget itself), attachmentId-keyed LRU (in-flight
 * deduped), and a never-throw contract: a failed, timed-out, or skipped
 * describe simply yields no map entry and the rewrite archives the image
 * without a description.
 *
 * The one-shot request follows the compaction-summarizer shape (single user
 * message, bounded maxTokens, turn signal); `purpose` is omitted — the
 * closed official union is reserved for first-party callers, and the
 * envelope attribution (provider/model) rides inline in the archive tag.
 *
 * @module dsh-mm-resilience/describe
 */

/** Cached descriptions per describer instance. */
const MAX_CACHED_DESCRIPTIONS = 256

const DESCRIBE_PROMPT =
  '用一段简洁的中文描述这张图片的关键可见信息（如界面元素、文字要点、图表数据、报错内容）。不确定的内容不要猜测。直接输出描述本身，不要任何前后缀。'

const DESCRIBE_MAX_TOKENS = 400

/**
 * @param {object} deps
 * @param {{ resolveModelInfo?: Function, stream?: Function }} deps.llm - the host llm service.
 * @param {() => { describeConcurrency: number, describeTimeoutMs: number, describeTotalBudgetMs: number, [key: string]: unknown }} deps.configRef
 * @returns {{ describeImages(refs: object[], route: {provider: string, model: string} | null, signal?: AbortSignal): Promise<Map<string, {text: string, provider: string, model: string}>> }}
 */
export function createDescriber({ llm, configRef }) {
  const cache = new Map()
  const inflight = new Map()

  async function routeImageCapable(provider, model, signal) {
    try {
      const info = await llm.resolveModelInfo(provider, model, signal)
      if (info?.inputModalities === undefined || !Array.isArray(info.inputModalities)) return false
      return info.inputModalities.includes('image')
    } catch {
      return false
    }
  }

  /**
   * One describe call under a ref'd per-call timeout (AbortSignal.timeout is
   * deliberately unref'd by Node and never fires on an otherwise-empty loop,
   * e.g. tests or sparse headless runs). The timer is always cleared and the
   * turn-signal relay always removed in `finally`.
   */
  async function describeOne(ref, route, signal, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const relay = () => controller.abort()
    signal?.addEventListener('abort', relay, { once: true })
    try {
      let text = ''
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', attachment: ref },
            { type: 'text', text: DESCRIBE_PROMPT },
          ],
        }],
        maxTokens: DESCRIBE_MAX_TOKENS,
        signal: controller.signal,
      })) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
      }
      const trimmed = text.trim()
      if (trimmed === '') return null
      return { text: trimmed, provider: route.provider, model: route.model }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', relay)
    }
  }

  /**
   * Describe up to `maxDescribedPerMessage` unique refs through a bounded
   * pool under a HARD total budget (a batch deadline controller aborts
   * in-flight calls too, so the worst-case bound is the budget itself, not
   * budget + per-call timeout); returns only the successful entries.
   *
   * @param {object[]} refs - unique live image attachment refs, first-appearance order.
   * @param {{ provider: string, model: string } | null} route - resolved describe route.
   * @param {AbortSignal} [signal] - the claiming turn's cancellation signal.
   */
  async function describeImages(refs, route, signal) {
    const config = configRef()
    const results = new Map()
    if (refs.length === 0 || route === null || typeof route?.provider !== 'string' || typeof route?.model !== 'string') {
      return results
    }
    if (!(await routeImageCapable(route.provider, route.model, signal))) return results

    const queue = refs.slice(0, config.maxDescribedPerMessage)
    // Batch deadline: ref'd timer (unref'd AbortSignal.timeout never fires on
    // an empty loop); fires into every in-flight call via signal composition.
    const deadlineController = new AbortController()
    const deadlineTimer = setTimeout(() => deadlineController.abort(), config.describeTotalBudgetMs)
    const composeSignal = () => {
      if (signal === undefined) return deadlineController.signal
      return AbortSignal.any([signal, deadlineController.signal])
    }

    async function worker() {
      for (;;) {
        const index = queue.shift()
        if (index === undefined) return
        if (signal?.aborted || deadlineController.signal.aborted) return
        const cached = cache.get(index.attachmentId)
        if (cached !== undefined) {
          cache.delete(index.attachmentId)
          cache.set(index.attachmentId, cached)
          results.set(index.attachmentId, cached)
          continue
        }
        const pending = inflight.get(index.attachmentId)
        if (pending !== undefined) {
          const joined = await pending.catch(() => null)
          if (joined !== null) results.set(index.attachmentId, joined)
          continue
        }
        const task = describeOne(index, route, composeSignal(), config.describeTimeoutMs)
          .then((entry) => {
            if (entry !== null) {
              cache.set(index.attachmentId, entry)
              if (cache.size > MAX_CACHED_DESCRIPTIONS) cache.delete(cache.keys().next().value)
            }
            return entry
          })
          .finally(() => inflight.delete(index.attachmentId))
        inflight.set(index.attachmentId, task)
        const entry = await task.catch(() => null)
        if (entry !== null) results.set(index.attachmentId, entry)
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(config.describeConcurrency, queue.length + 1) }, worker))
    } finally {
      clearTimeout(deadlineTimer)
    }
    return results
  }

  return { describeImages }
}
