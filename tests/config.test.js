/**
 * Config schema + runtime materialization. Schema defaults ARE the official
 * takeover values (plugin install == official behavior): pixel budget
 * 4,194,304 == llm-pi-ai DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET; per-message
 * describe cap 20 == attachment-local DEFAULT_MAX_IMAGES_PER_MESSAGE. The
 * schema is the loud validation layer; materializeConfig is fail-soft and
 * never throws (an activation crash hides the plugin's own settings card).
 *
 * @module dsh-mm-resilience/tests/config.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, DEFAULTS, materializeConfig } from '../src/config.js'

test('defaults are the official takeover values', () => {
  assert.equal(DEFAULTS.maxImagePixels, 4_194_304) // 2048×2048, llm-pi-ai default
  assert.equal(DEFAULTS.maxDescribedPerMessage, 20) // attachment-local default
  assert.equal(DEFAULTS.describeConcurrency, 4)
  assert.deepEqual(Object.keys(DEFAULTS).sort(), ['describeConcurrency', 'maxDescribedPerMessage', 'maxImagePixels'])
})

test('Config: callable schema; volatile fields resolve to {get()} handles with official defaults', () => {
  const parsed = Config({})
  // schemastery volatile fields parse into { get() } handles — the exact
  // runtime shape `apply` also receives; materializeConfig is the reader.
  assert.equal(typeof parsed.maxImagePixels.get, 'function')
  assert.equal(parsed.maxImagePixels.get(), 4_194_304)
  assert.equal(parsed.maxDescribedPerMessage.get(), 20)
  assert.equal(parsed.describeConcurrency.get(), 4)
})

test('Config: schema-layer bounds', () => {
  assert.throws(() => Config({ maxImagePixels: 262_143 }))
  assert.throws(() => Config({ maxImagePixels: 4_194_305 }))
  assert.equal(Config({ maxImagePixels: 262_144 }).maxImagePixels.get(), 262_144)
  assert.throws(() => Config({ maxDescribedPerMessage: 0 }))
  assert.throws(() => Config({ maxDescribedPerMessage: 21 }))
  assert.throws(() => Config({ describeConcurrency: 0 }))
  assert.throws(() => Config({ describeConcurrency: 9 }))
})

test('materializeConfig: plain runtime values pass through', () => {
  const config = materializeConfig({ maxImagePixels: 262_144, describeConcurrency: 2 })
  assert.equal(config.maxImagePixels, 262_144)
  assert.equal(config.describeConcurrency, 2)
  assert.equal(config.maxDescribedPerMessage, DEFAULTS.maxDescribedPerMessage)
})

test('materializeConfig: volatile {get()} handles are unwrapped', () => {
  const config = materializeConfig({
    maxImagePixels: { get: () => 512 * 512 },
    maxDescribedPerMessage: { get: () => 3 },
  })
  assert.equal(config.maxImagePixels, 262_144)
  assert.equal(config.maxDescribedPerMessage, 3)
})

test('materializeConfig: invalid or absent values fall back to official defaults without throwing', () => {
  const config = materializeConfig({
    maxImagePixels: -5,
    maxDescribedPerMessage: 2.5,
    describeConcurrency: { x: 1 },
  })
  assert.deepEqual(config, { ...DEFAULTS })
})

test('materializeConfig: stale profile keys from removed fields are invisible', () => {
  const config = materializeConfig({
    enabled: false,
    describeProvider: 'sz',
    describeModel: 'vl',
    describeTimeoutMs: 1,
    describeTotalBudgetMs: 1,
    maxImagePixels: 1_048_576,
  })
  assert.equal('enabled' in config, false)
  assert.equal(config.maxImagePixels, 1_048_576)
})

test('materializeConfig: null/absent runtime object yields defaults', () => {
  assert.deepEqual(materializeConfig({}), { ...DEFAULTS })
  assert.deepEqual(materializeConfig(null), { ...DEFAULTS })
})
