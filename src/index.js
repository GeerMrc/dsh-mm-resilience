/**
 * dsh-mm-resilience host half.
 *
 * Pure-prevention image governance: every pasted image is parsed once
 * (bounded auxiliary describe), archived in place (`offloaded: true` + an
 * adjacent description tag), and never re-serialized as image bytes by any
 * later request; re-view happens on explicit demand through the
 * `mm_view_image` tool, whose pixels ride exactly the one request derived
 * next and are egressed by the following pre-step. `enabled: false` makes
 * both the archive rewrite and the tool inert while the fiber stays mounted
 * (volatile settings commit in place without re-running `apply`, so config is
 * re-materialized on every event, not snapshotted once).
 *
 * @module dsh-mm-resilience
 */
import { Config, materializeConfig } from './config.js'
import { collectLiveImageRefs, rewriteMessage } from './blocks.js'
import { createDescriber } from './describe.js'
import { createEgressState, egressLiveToolImages } from './egress.js'
import { createViewImageTool } from './tool.js'

export { Config }

/** Services used at runtime; registrations are scoped effects of `apply`. */
export const inject = ['llm', 'tools']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} rawConfig - volatile handles or plain values, read live.
 */
export function apply(ctx, rawConfig) {
  /** Live snapshot per event (volatile fields are `{ get() }` handles whose
   * committed values change in place; materializeConfig is pure and cheap). */
  const liveConfig = () => materializeConfig(rawConfig)
  const describer = createDescriber({ llm: ctx.llm, configRef: liveConfig })
  /** Per-session egress fence (WeakMap: state dies with the session). */
  const egressStates = new WeakMap()
  const egressStateOf = (session) => {
    let state = egressStates.get(session)
    if (state === undefined) {
      state = createEgressState()
      egressStates.set(session, state)
    }
    return state
  }

  const { whenHandler, ...toolDefinition } = createViewImageTool({ llm: ctx.llm, describer, configRef: liveConfig })
  ctx.tools.register(toolDefinition, { when: whenHandler })

  ctx.on('agent/pre-step', async (payload, next) => {
    const config = liveConfig()
    // Egress first, fenced on rode-once (see egress.js); warn-only.
    if (config.enabled) {
      try {
        egressLiveToolImages(payload?.agent?.session, egressStateOf(payload?.agent?.session))
      } catch (error) {
        console.warn(`[mm-resilience] egress pass skipped: ${error?.message ?? error}`)
      }
    }

    const decision = await next()
    // A request will be derived from the post-pass surface only on `enter`.
    if (config.enabled && payload?.agent?.session !== undefined) {
      egressStateOf(payload.agent.session).requestedSinceSeen = decision?.kind === 'enter'
    }
    if (!config.enabled) return decision
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
