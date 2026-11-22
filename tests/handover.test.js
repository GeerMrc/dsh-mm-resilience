/**
 * Symmetric takeover/handover of the official per-route pixel budget.
 *
 * @module dsh-mm-resilience/tests/handover.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { reconcileTakeover, revertHandover } from '../src/handover.js'

const DEFAULT = 4_194_304

function fakeSettings({ routes, mutateImpl } = {}) {
  // routes: [{ route, overrideRow?, inheritedRow? }] — overrideRow undefined
  // means the budget row is absent from the profile patch.
  const providers = {}
  const userProviders = {}
  const baseProviders = {}
  for (const { route, overrideRow, inheritedRow = DEFAULT } of routes ?? []) {
    providers[route] = { requestImagePixelBudget: overrideRow ?? inheritedRow }
    baseProviders[route] = { requestImagePixelBudget: inheritedRow }
    if (overrideRow !== undefined) userProviders[route] = { requestImagePixelBudget: overrideRow }
  }
  const calls = []
  return {
    calls,
    describe: () => [{ ns: 'llm-pi-ai', revision: 7, value: { providers }, user: { providers: userProviders }, base: { providers: baseProviders } }],
    mutate: mutateImpl ?? (async (ns, ops, revision) => { calls.push({ ns, ops, revision }) }),
  }
}

test('takeover: fills ONLY absent rows when effective differs from official default', async () => {
  const settings = fakeSettings({ routes: [
    { route: 'sz' },                                // absent row
    { route: 'hh', overrideRow: 1_048_576 },        // ours (previous fan-out)
    { route: 'zai', overrideRow: 262_144 },         // user's manual value
  ] })
  await reconcileTakeover(settings, 1_048_576)
  assert.equal(settings.calls.length, 1)
  assert.deepEqual(settings.calls[0], {
    ns: 'llm-pi-ai',
    ops: [{ op: 'set', path: ['providers', 'sz', 'requestImagePixelBudget'], value: 1_048_576 }],
    revision: 7,
  })
})

test('takeover: no write when the effective budget IS the official default (no churn)', async () => {
  const settings = fakeSettings({ routes: [{ route: 'sz' }, { route: 'hh', overrideRow: DEFAULT }] })
  assert.equal(reconcileTakeover(settings, DEFAULT), undefined)
  assert.equal(settings.calls.length, 0)
})

test('takeover: no write when nothing is absent; absent settings service is a no-op', async () => {
  const settings = fakeSettings({ routes: [{ route: 'sz', overrideRow: 262_144 }] })
  await reconcileTakeover(settings, 1_048_576)
  assert.equal(settings.calls.length, 0)
  assert.equal(reconcileTakeover(undefined, 1_048_576), undefined)
})

test('revert: unsets ONLY rows still equal to the effective value (ours), keeps manual rows', async () => {
  const settings = fakeSettings({ routes: [
    { route: 'sz', overrideRow: 1_048_576 },   // ours → hand over
    { route: 'hh', overrideRow: DEFAULT },     // historical default row → cleaned
    { route: 'zai', overrideRow: 262_144 },    // user manual → survive
    { route: 'strata' },                       // absent → untouched
  ] })
  await revertHandover(settings, 1_048_576)
  // hh row: equal to DEFAULT but effective is 1048576 → NOT equal to effective → kept?
  // Per design: only rows equal to the EFFECTIVE applied value revert. The
  // historical DEFAULT rows belong to a fan-out era when effective == DEFAULT;
  // with a custom effective now they may equally be the user's manual default.
  assert.deepEqual(settings.calls[0].ops, [
    { op: 'unset', path: ['providers', 'sz', 'requestImagePixelBudget'] },
  ])
  assert.equal(settings.calls[0].ns, 'llm-pi-ai')
  assert.equal(settings.calls[0].revision, 7)
})

test('revert at default effective: cleans rows pinned at the official default (historical fan-out)', async () => {
  const settings = fakeSettings({ routes: [
    { route: 'sz', overrideRow: DEFAULT },     // historical ours
    { route: 'zai', overrideRow: 262_144 },    // user manual → survive
    { route: 'hh' },                           // absent
  ] })
  await revertHandover(settings, DEFAULT)
  assert.deepEqual(settings.calls[0].ops, [
    { op: 'unset', path: ['providers', 'sz', 'requestImagePixelBudget'] },
  ])
})

test('revert: absent service / no matching rows / throwing mutate — warn-only, never throws', async () => {
  assert.doesNotThrow(() => revertHandover(undefined, DEFAULT))
  const quiet = fakeSettings({ routes: [{ route: 'sz' }] })
  await revertHandover(quiet, DEFAULT)
  assert.equal(quiet.calls.length, 0)
  const throwing = fakeSettings({ routes: [{ route: 'sz', overrideRow: DEFAULT }], mutateImpl: async () => { throw new Error('reload race') } })
  await assert.doesNotThrow(() => revertHandover(throwing, DEFAULT))
  const throwingDescribe = { describe: () => { throw new Error('busy') }, mutate: async () => {} }
  await assert.doesNotThrow(() => revertHandover(throwingDescribe, DEFAULT))
  await assert.doesNotThrow(() => reconcileTakeover(throwingDescribe, 1_048_576))
})

test('user-layer fallback: value/base divergence detects an override row when the user projection omits it', async () => {
  const providers = { sz: { requestImagePixelBudget: 1_048_576 }, hh: { requestImagePixelBudget: DEFAULT } }
  const base = { sz: { requestImagePixelBudget: DEFAULT }, hh: { requestImagePixelBudget: DEFAULT } }
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', revision: 3, value: { providers }, user: {}, base: { providers: base } }],
    mutate: async (ns, ops, revision) => { settings.calls = [{ ns, ops, revision }] },
  }
  await revertHandover(settings, 1_048_576)
  assert.deepEqual(settings.calls[0].ops, [{ op: 'unset', path: ['providers', 'sz', 'requestImagePixelBudget'] }])
})

test('F1 regression: user-layer-only route (absent from base) is ABSENT — reconcile fills it, revert never phantom-unsets', async () => {
  // Route 'manual' exists only in the user profile patch (added on the
  // Models page); base lacks it. valueRow is the schema-materialized default.
  const DEFAULT2 = 4_194_304
  const providers = { manual: { requestImagePixelBudget: DEFAULT2 }, sz: { requestImagePixelBudget: DEFAULT2 } }
  const user = { providers: {} }                       // no budget rows anywhere
  const base = { providers: { sz: { requestImagePixelBudget: DEFAULT2 } } }  // manual NOT in base
  const calls = []
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', revision: 5, value: { providers }, user, base: { providers: base.providers } }],
    mutate: async (ns, ops, revision) => { calls.push({ ns, ops, revision }) },
  }
  // Reconcile at custom effective: BOTH routes absent -> fill both (the
  // backstop's stated purpose: routes added after the last save).
  await reconcileTakeover(settings, 1_048_576)
  assert.equal(calls[0].ops.length, 2)
  // Revert at default effective: no phantom rows -> zero writes, no churn.
  calls.length = 0
  await revertHandover(settings, DEFAULT2)
  assert.equal(calls.length, 0)
})
