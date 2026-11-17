/**
 * Configuration schema and runtime materialization for dsh-mm-resilience.
 *
 * Every card-editable field is `.volatile()` (live settings form); schema
 * DEFAULTS are the OFFICIAL takeover values — installing the plugin leaves
 * DSH behavior numerically identical (pixel budget 2048×2048, per-message
 * describe cap 20), and the official 恢复-default control on each field
 * stages a clear that re-inherits exactly these values. `materializeConfig`
 * is fail-soft by design: the schema is the loud validation layer (settings
 * writes are rejected there), while runtime materialization falls back to
 * defaults so a malformed config can never crash plugin activation (an
 * activation crash hides the plugin's own settings card).
 *
 * @module dsh-mm-resilience/config
 */
import z from '@deepseek-ai/schemastery'

/**
 * Resolved defaults. `maxImagePixels` mirrors llm-pi-ai's
 * DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET (2048×2048) and `maxDescribedPerMessage`
 * mirrors attachment-local's DEFAULT_MAX_IMAGES_PER_MESSAGE (20); the pixel
 * ceiling equals the intake-normalization cap (2048×2048), so a larger
 * request budget is unrecoverable by construction.
 */
export const DEFAULTS = Object.freeze({
  maxImagePixels: 4_194_304,
  maxDescribedPerMessage: 20,
  describeConcurrency: 4,
})

/** Validation schema; the settings service exposes exactly the volatile fields. */
export const Config = z.object({
  maxImagePixels: z.number().step(1).min(262_144).max(4_194_304).default(4_194_304).volatile(),
  maxDescribedPerMessage: z.number().step(1).min(1).max(20).default(20).volatile(),
  describeConcurrency: z.number().step(1).min(1).max(8).default(4).volatile(),
})

/** Per-key runtime predicates mirroring the schema bounds. */
const isValid = {
  maxImagePixels: (v) => Number.isInteger(v) && v >= 262_144 && v <= 4_194_304,
  maxDescribedPerMessage: (v) => Number.isInteger(v) && v >= 1 && v <= 20,
  describeConcurrency: (v) => Number.isInteger(v) && v >= 1 && v <= 8,
}

/**
 * Unwrap a runtime config into a plain snapshot: `{ get() }` volatile handles
 * are read through, plain values pass through, and invalid or absent values
 * fall back to {@link DEFAULTS} without ever throwing. Stale keys from
 * removed fields are invisible (iteration covers DEFAULTS keys only).
 * Shallow by construction — volatile marks sit exactly on the top-level fields.
 *
 * @param {object | null | undefined} runtime - the config the host handed over.
 * @returns {typeof DEFAULTS} the plain snapshot for one decision pass.
 */
export function materializeConfig(runtime) {
  const out = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const value = runtime?.[key]
    const unwrapped = value !== null && typeof value === 'object' && typeof value.get === 'function'
      ? value.get()
      : value
    if (unwrapped === undefined || unwrapped === null) continue
    if (!isValid[key](unwrapped)) {
      console.warn(`[mm-resilience] config: ignoring invalid "${key}" (${String(unwrapped)}), using default`)
      continue
    }
    out[key] = unwrapped
  }
  return out
}
