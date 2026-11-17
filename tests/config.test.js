/**
 * Config schema + runtime materialization (volatile unwrap, fail-soft
 * normalization). The schema is the loud validation layer (settings writes
 * are rejected there); materializeConfig is defensive at runtime and must
 * never throw — an activation crash hides the plugin's own settings card
 * (the previous build's fatal lesson).
 *
 * @module dsh-mm-resilience/tests/config.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, DEFAULTS, materializeConfig } from '../src/config.js'

test('Config: callable schema; volatile fields resolve to {get()} handles with defaults', () => {
  const parsed = Config({})
  // schemastery volatile fields parse into { get() } handles — the exact
  // runtime shape `apply` also receives; materializeConfig is the reader.
  assert.equal(typeof parsed.enabled.get, 'function')
  assert.equal(parsed.enabled.get(), true)
  assert.equal(parsed.maxImagePixels.get(), 1_048_576)
  assert.equal(parsed.describeConcurrency.get(), 4)
  assert.equal(parsed.describeProvider.get(), '')
  assert.equal(parsed.maxDescribedPerMessage.get(), 8)
})

test('Config: maxDescribedPerMessage bounded to the official per-message image cap (20)', () => {
  assert.throws(() => Config({ maxDescribedPerMessage: 0 }))
  assert.throws(() => Config({ maxDescribedPerMessage: 21 }))
  assert.equal(Config({ maxDescribedPerMessage: 3 }).maxDescribedPerMessage.get(), 3)
})

test('Config: out-of-range pixel budget is rejected at the schema layer', () => {
  assert.throws(() => Config({ maxImagePixels: 99 }))
  assert.throws(() => Config({ maxImagePixels: 5_000_000 })) // > 2048² intake ceiling
})

test('materializeConfig: plain runtime values pass through', () => {
  const config = materializeConfig({ enabled: false, maxImagePixels: 262_144 })
  assert.equal(config.enabled, false)
  assert.equal(config.maxImagePixels, 262_144)
  assert.equal(config.describeConcurrency, DEFAULTS.describeConcurrency)
})

test('materializeConfig: volatile {get()} handles are unwrapped', () => {
  const config = materializeConfig({
    enabled: { get: () => false },
    maxImagePixels: { get: () => 512 * 512 },
  })
  assert.equal(config.enabled, false)
  assert.equal(config.maxImagePixels, 262_144)
})

test('materializeConfig: invalid or absent values fall back to defaults without throwing', () => {
  const config = materializeConfig({
    enabled: 'yes-please',          // wrong type -> default true
    maxImagePixels: -5,             // out of range -> default
    describeConcurrency: 2.5,       // not an integer -> default
    describeTimeoutMs: NaN,         // -> default
    describeTotalBudgetMs: { x: 1 },// object -> default
    describeProvider: 42,           // wrong type -> default ''
  })
  assert.deepEqual(config, { ...DEFAULTS })
})

test('materializeConfig: null/undefined/empty-string treated as absent', () => {
  const config = materializeConfig({
    enabled: undefined,
    maxImagePixels: null,
    describeProvider: '',
    describeModel: null,
  })
  assert.deepEqual(config, { ...DEFAULTS })
})

test('materializeConfig: null/absent runtime object yields defaults', () => {
  assert.deepEqual(materializeConfig({}), { ...DEFAULTS })
  assert.deepEqual(materializeConfig(null), { ...DEFAULTS })
})

test('materializeConfig: describe provider/model strings accepted when both non-empty', () => {
  const config = materializeConfig({ describeProvider: 'sz', describeModel: 'Qwen3.8-27B-FP8' })
  assert.equal(config.describeProvider, 'sz')
  assert.equal(config.describeModel, 'Qwen3.8-27B-FP8')
})
