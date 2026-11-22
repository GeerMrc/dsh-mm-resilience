/**
 * Symmetric takeover/handover of the official per-route pixel budget
 * (`providers.<route>.requestImagePixelBudget` on llm-pi-ai):
 *
 * - Takeover (apply-time reconcile): when the plugin's effective pixel
 *   budget differs from the official default, fill ONLY routes whose budget
 *   row is absent from the profile override layer — routes carrying any
 *   explicit row (the user's own Models-page value, or a previous fan-out)
 *   are never touched. Idempotent; no writes when the effective budget is
 *   the official default.
 * - Handover (disable-time revert, best effort): when the plugin fiber is
 *   destroyed (bundle switched off / uninstalled), unset ONLY rows whose
 *   override value still equals the plugin's effective budget — the user's
 *   divergent manual values survive; equal-to-default historical rows are
 *   cleaned (behaviourally a no-op, presence restored to official inherit).
 *
 * The disable-time revert rides TWO channels because the desktop host has
 * no HMR: there the bundle switch does NOT unload fibers (rc.5 reload()
 * only recomposes statically), so this dispose hook fires only on HMR
 * hosts; the desktop-effective channel is the CLIENT half's
 * plugin-manager/changed watch (client/index.js). Both are warn-only: a
 * failing settings call never blocks startup or teardown. A missed revert
 * (web client closed at disable time) leaves rows active until the next
 * enable + card save + disable, or manual removal — disclosed in README.
 *
 * @module dsh-mm-resilience/handover
 */

const LLM_NS = 'llm-pi-ai'
/** Official llm-pi-ai DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET (2048×2048). */
const OFFICIAL_DEFAULT_PIXELS = 4_194_304

const warn = (message) => console.warn(`[mm-resilience] ${message}`)

/**
 * One route row's override state: the profile-patch value when a row exists
 * (user layer, with a value/base divergence fallback for projections that
 * omit it), else undefined.
 */
function routeRows(descriptor) {
  const providers = descriptor?.value?.providers
  if (providers === undefined || providers === null || typeof providers !== 'object') return []
  const userProviders = descriptor?.user?.providers
  const baseProviders = descriptor?.base?.providers
  return Object.keys(providers).map((route) => {
    const valueRow = providers[route]?.requestImagePixelBudget
    const userRow = userProviders?.[route]?.requestImagePixelBudget
    const baseRow = baseProviders?.[route]?.requestImagePixelBudget
    // Fallback only for routes present in the base layer: a route authored
    // solely in the user profile has baseRow undefined and valueRow
    // materialized by schema defaults — that is an ABSENT row, not an
    // override (a phantom "present" would break the reconcile backstop and
    // cause recurring no-op unsets at default effective).
    const overrideRow = userRow !== undefined
      ? userRow
      : baseRow !== undefined && valueRow !== baseRow ? valueRow : undefined
    return { route, overrideRow }
  })
}

function descriptorOf(settings) {
  const described = settings.describe()
  return Array.isArray(described)
    ? described.find((entry) => entry?.ns === LLM_NS)
    : undefined
}

/**
 * Fill absent budget rows with the effective budget (takeover backstop for
 * re-enable after a revert, and for routes added after the last save).
 *
 * @param {object | undefined} settings - the host settings service (ctx.get).
 * @param {number} effectivePixels - the plugin's effective pixel budget.
 */
export function reconcileTakeover(settings, effectivePixels) {
  if (settings === undefined || effectivePixels === OFFICIAL_DEFAULT_PIXELS) return
  let descriptor
  try {
    descriptor = descriptorOf(settings)
  } catch (error) {
    warn(`takeover reconcile skipped: ${error?.message ?? error}`)
    return
  }
  if (descriptor === undefined) return
  const ops = routeRows(descriptor)
    .filter((row) => row.overrideRow === undefined)
    .map((row) => ({ op: 'set', path: ['providers', row.route, 'requestImagePixelBudget'], value: effectivePixels }))
  if (ops.length === 0) return
  // Sync-throw + async-reject both caught: Promise.resolve alone cannot
  // wrap an argument expression that throws before it is invoked.
  try {
    return Promise.resolve(settings.mutate(LLM_NS, ops, descriptor.revision))
      .catch((error) => warn(`takeover reconcile write failed: ${error?.message ?? error}`))
  } catch (error) {
    warn(`takeover reconcile write failed: ${error?.message ?? error}`)
    return Promise.resolve()
  }
}

/**
 * Unset budget rows that still carry the plugin's effective value (handover
 * on disable). Divergent manual rows survive; absent rows are untouched.
 *
 * @param {object | undefined} settings - the host settings service (ctx.get).
 * @param {number} effectivePixels - the plugin's effective pixel budget.
 */
export function revertHandover(settings, effectivePixels) {
  if (settings === undefined) return
  let descriptor
  try {
    descriptor = descriptorOf(settings)
  } catch (error) {
    warn(`handover revert skipped: ${error?.message ?? error}`)
    return
  }
  if (descriptor === undefined) return
  const ops = routeRows(descriptor)
    .filter((row) => row.overrideRow === effectivePixels)
    .map((row) => ({ op: 'unset', path: ['providers', row.route, 'requestImagePixelBudget'] }))
  if (ops.length === 0) return
  // Sync-throw + async-reject both caught: Promise.resolve alone cannot
  // wrap an argument expression that throws before it is invoked.
  try {
    return Promise.resolve(settings.mutate(LLM_NS, ops, descriptor.revision))
      .catch((error) => warn(`handover revert write failed: ${error?.message ?? error}`))
  } catch (error) {
    warn(`handover revert write failed: ${error?.message ?? error}`)
    return Promise.resolve()
  }
}
