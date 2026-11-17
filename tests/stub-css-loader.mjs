/**
 * Test-only module loader for running the REAL ui-primitives bundle under
 * plain node (real-SettingsFormModel repro/tests). The published bundle
 * imports every component's dependencies eagerly while relying on host
 * hoisting, so: resolvable modules load for real; bare specifiers that fail
 * to resolve (shiki/katex/anser/diff/... — components the card never
 * executes) and all `.css` imports stub to empty modules.
 *
 * Used as: node --loader ./tests/stub-css-loader.mjs --test tests/
 *
 * @module dsh-mm-resilience/tests/stub-css-loader
 */
const STUB = { url: 'data:text/javascript,export default {}', shortCircuit: true }

// Markdown/syntax-highlight families: eagerly evaluated by the bundle but
// never executed by the card's components (and version-skewed transitively).
const PRE_STUBBED = [/^micromark/, /^mdast/, /^hast/, /^unist/, /^vfile/, /^markdown-it/, /^katex/, /^shiki/, /^@shikijs\//, /^anser/, /^diff/, /^refractor/, /^starry-night/, /^highlight/]

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('data:')) return nextResolve(specifier, context)
  if (PRE_STUBBED.some((pattern) => pattern.test(specifier))) return STUB
  try {
    const resolved = await nextResolve(specifier, context)
    if (resolved.url.endsWith('.css')) return STUB
    return resolved
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && !specifier.startsWith('.') && !specifier.startsWith('/')) {
      return STUB
    }
    throw error
  }
}
