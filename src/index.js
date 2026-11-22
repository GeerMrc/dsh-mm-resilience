/**
 * dsh-mm-resilience host half.
 *
 * Pure-prevention image governance: every pasted image is archived in place
 * (`offloaded: true`, bubble renders exactly like native DSH) with its
 * parse-once description carried by a separate context-injection message
 * (official collapsed row); image bytes are never re-serialized by any
 * later request; re-view happens on explicit demand through the
 * `mm_view_image` tool, whose pixels ride exactly the one request derived
 * next and are egressed by the following pre-step. The per-route pixel
 * budget is taken over on start (absent rows filled) and handed back to the
 * official default on disable (rows still carrying our value are unset). The describe route is
 * ALWAYS the session's current model selection (a non-multimodal model means
 * parsing is unavailable — the honest behavior); the bundle's Plugins-page
 * enable switch is the plugin's only on/off (off unmounts everything and
 * official behavior resumes).
 *
 * @module dsh-mm-resilience
 */
import { Config, materializeConfig } from './config.js'
import { archiveContextMessage, collectLiveImageRefs, rewriteMessage } from './blocks.js'
import { createDescriber } from './describe.js'
import { createEgressState, egressLiveToolImages } from './egress.js'
import { createViewImageTool } from './tool.js'
import { reconcileTakeover, revertHandover } from './handover.js'

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

  const { whenHandler, ...toolDefinition } = createViewImageTool({ llm: ctx.llm, describer })
  ctx.tools.register(toolDefinition, { when: whenHandler })

  // Symmetric takeover/handover of the official per-route pixel budget: on
  // start (and re-enable), fill budget rows absent from the profile with the
  // effective budget; on disable (fiber destroy), unset rows still carrying
  // our value so the official default takes over again. Divergent manual
  // rows are never touched; both paths are warn-only (see handover.js).
  const settings = () => (typeof ctx.get === 'function' ? ctx.get('settings') : undefined)
  const effectivePixels = () => liveConfig().maxImagePixels
  void reconcileTakeover(settings(), effectivePixels())
  ctx.effect(() => () => { void revertHandover(settings(), effectivePixels()) }, 'mm-resilience: pixel-budget handover')

  ctx.on('agent/pre-step', async (payload, next) => {
    // Egress first, fenced on rode-once (see egress.js); warn-only.
    try {
      egressLiveToolImages(payload?.agent?.session, egressStateOf(payload?.agent?.session))
    } catch (error) {
      console.warn(`[mm-resilience] egress pass skipped: ${error?.message ?? error}`)
    }

    const decision = await next()
    // A request will be derived from the post-pass surface only on `enter`.
    if (payload?.agent?.session !== undefined) {
      egressStateOf(payload.agent.session).requestedSinceSeen = decision?.kind === 'enter'
    }
    if (decision?.kind !== 'enter' || !Array.isArray(decision.messages)) return decision

    const refs = collectLiveImageRefs(decision.messages)
    if (refs.length === 0) return decision

    // The describe route is the claiming step's model selection, period.
    const modelSelection = payload?.modelSelection
    let route = null
    if (typeof modelSelection?.provider === 'string' && typeof modelSelection?.model === 'string'
      && modelSelection.provider !== '' && modelSelection.model !== '') {
      route = { provider: modelSelection.provider, model: modelSelection.model }
    }
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
      const rewritten = rewriteMessage(message)
      messages.push(rewritten ?? message)
      if (rewritten !== null) changed = true
    }
    // Descriptions ride as ONE context-injection message (official collapsed
    // row via source kind; never inside the user's bubble). No description
    // succeeded → no row at all.
    const archive = archiveContextMessage(descriptions, refs)
    if (archive !== null) {
      messages.push(archive)
      changed = true
    }
    return changed ? { ...decision, messages } : decision
  })
}
