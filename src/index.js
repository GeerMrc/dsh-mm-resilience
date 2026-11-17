/**
 * dsh-mm-resilience host half.
 *
 * Pure-prevention image governance: every pasted image is parsed once
 * (bounded auxiliary describe), archived in place (`offloaded: true` + an
 * adjacent description tag), and never re-serialized as image bytes by any
 * later request; re-view happens on explicit demand through the
 * `mm_view_image` tool, whose pixels ride exactly the consuming step and are
 * egressed at the next pre-step. `enabled: false` leaves official behavior
 * untouched.
 *
 * @module dsh-mm-resilience
 */
import { Config, materializeConfig } from './config.js'
import { collectLiveImageRefs, rewriteMessage } from './blocks.js'
import { createDescriber } from './describe.js'
import { egressLiveToolImages } from './egress.js'
import { createViewImageTool } from './tool.js'

export { Config }

/** Services used at runtime; registrations are scoped effects of `apply`. */
export const inject = ['llm', 'tools']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} rawConfig - volatile handles or plain values.
 */
export function apply(ctx, rawConfig) {
  const config = materializeConfig(rawConfig)
  if (!config.enabled) {
    console.info('[mm-resilience] disabled by config; plugin passive')
    return
  }
  const describer = createDescriber({ llm: ctx.llm, config })

  const { whenHandler, ...toolDefinition } = createViewImageTool({ llm: ctx.llm, describer })
  ctx.tools.register(toolDefinition, { when: whenHandler })

  ctx.on('agent/pre-step', async (payload, next) => {
    // Egress first: pixels from a consumed mm_view_image / read_image result
    // must not ride this or any later request (warn-only on failure).
    try {
      egressLiveToolImages(payload?.agent?.session)
    } catch (error) {
      console.warn(`[mm-resilience] egress pass skipped: ${error?.message ?? error}`)
    }

    const decision = await next()
    if (decision?.kind !== 'enter' || !Array.isArray(decision.messages)) return decision

    const refs = collectLiveImageRefs(decision.messages)
    if (refs.length === 0) return decision

    const route = resolveDescribeRoute(config, payload?.modelSelection)
    let descriptions = new Map()
    if (route !== null) {
      try {
        descriptions = await describer.describeImages(refs, route, payload?.signal)
      } catch (error) {
        console.warn(`[mm-resilience] describe pass skipped: ${error?.message ?? error}`)
      }
    }

    const messages = []
    let changed = false
    for (const message of decision.messages) {
      // The loop re-projects runtime-context messages from scratch; rewriting
      // them here would be discarded work on a frozen input.
      if (message?.source?.kind === 'runtime-context') {
        messages.push(message)
        continue
      }
      const rewritten = rewriteMessage(message, descriptions)
      messages.push(rewritten ?? message)
      if (rewritten !== null) changed = true
    }
    return changed ? { ...decision, messages } : decision
  })
}

/**
 * Describe route precedence: explicit configured pair, else the claiming
 * step's model selection. `null` archives without descriptions.
 *
 * @param {{ describeProvider: string, describeModel: string }} config
 * @param {{ provider?: string, model?: string } | undefined} modelSelection
 * @returns {{ provider: string, model: string } | null}
 */
function resolveDescribeRoute(config, modelSelection) {
  if (config.describeProvider !== '' && config.describeModel !== '') {
    return { provider: config.describeProvider, model: config.describeModel }
  }
  if (typeof modelSelection?.provider === 'string' && typeof modelSelection?.model === 'string'
    && modelSelection.provider !== '' && modelSelection.model !== '') {
    return { provider: modelSelection.provider, model: modelSelection.model }
  }
  return null
}
