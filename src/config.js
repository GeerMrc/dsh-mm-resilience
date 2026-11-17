/**
 * Configuration schema and runtime materialization for dsh-mm-resilience.
 *
 * Every settings-card-editable field is `.volatile()`: on hosts with the
 * settings service the namespace registers as a live form whose committed
 * changes apply without restart, and `apply` receives each field as a
 * `Volatile` `{ get() }` handle; without volatile support values arrive
 * plain. Both shapes normalize through {@link materializeConfig}, which is
 * fail-soft by design — the schema is the loud validation layer (settings
 * writes are rejected there), while runtime materialization falls back to
 * defaults so a malformed config can never crash plugin activation (an
 * activation crash hides the plugin's own settings card).
 *
 * @module dsh-mm-resilience/config
 */
import z from '@deepseek-ai/schemastery'

/**
 * Resolved defaults. `maxImagePixels` is the b1 pixel budget (total-pixel
 * area; 1_048_576 = "1024×1024 information"). The ceiling is 2048×2048:
 * attachment intake normalization already caps stored images at that area
 * (attachment-local DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS), so a larger
 * request budget is unrecoverable by construction.
 */
export const DEFAULTS = Object.freeze({
  enabled: true,
  maxImagePixels: 1_048_576,
  /** b2: per-message describe budget — first N pasted images get a description, the rest archive without one. Bounded by the official hard admission cap (20 per message, attachment-local maxImagesPerMessage, which is NOT settings-writable). */
  maxDescribedPerMessage: 8,
  /** Auxiliary describe route; empty strings = "use the session's current route". */
  describeProvider: '',
  describeModel: '',
  describeConcurrency: 4,
  describeTimeoutMs: 10_000,
  describeTotalBudgetMs: 15_000,
})

/** Validation schema; the settings service exposes exactly the volatile fields. */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile(),
  maxImagePixels: z.number().step(1).min(262_144).max(4_194_304).default(1_048_576).volatile(),
  maxDescribedPerMessage: z.number().step(1).min(1).max(20).default(8).volatile(),
  describeProvider: z.string().default('').volatile(),
  describeModel: z.string().default('').volatile(),
  describeConcurrency: z.number().step(1).min(1).max(8).default(4).volatile(),
  describeTimeoutMs: z.number().step(1).min(1_000).max(60_000).default(10_000).volatile(),
  describeTotalBudgetMs: z.number().step(1).min(1_000).max(120_000).default(15_000).volatile(),
})

/** Per-key runtime predicates mirroring the schema bounds. */
const isValid = {
  enabled: (v) => typeof v === 'boolean',
  maxImagePixels: (v) => Number.isInteger(v) && v >= 262_144 && v <= 4_194_304,
  maxDescribedPerMessage: (v) => Number.isInteger(v) && v >= 1 && v <= 20,
  describeProvider: (v) => typeof v === 'string',
  describeModel: (v) => typeof v === 'string',
  describeConcurrency: (v) => Number.isInteger(v) && v >= 1 && v <= 8,
  describeTimeoutMs: (v) => Number.isInteger(v) && v >= 1_000 && v <= 60_000,
  describeTotalBudgetMs: (v) => Number.isInteger(v) && v >= 1_000 && v <= 120_000,
}

/** Keys whose empty string means "unset, keep default". */
const EMPTY_MEANS_ABSENT = new Set(['describeProvider', 'describeModel'])

/**
 * Unwrap a runtime config into a plain snapshot: `{ get() }` volatile handles
 * are read through, plain values pass through, and invalid or absent values
 * fall back to {@link DEFAULTS} without ever throwing. Shallow by
 * construction — volatile marks sit exactly on the top-level fields.
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
    if (EMPTY_MEANS_ABSENT.has(key) && unwrapped === '') continue
    if (!isValid[key](unwrapped)) {
      console.warn(`[mm-resilience] config: ignoring invalid "${key}" (${String(unwrapped)}), using default`)
      continue
    }
    out[key] = unwrapped
  }
  return out
}
