/**
 * Client-half smoke test: executes the prebuilt factory file exactly the way
 * the browser would (window.__ModuleLoader__.load capture → factory(require)
 * → apply(fakeCtx)) with fake react/configForms/slots/locale, asserting the
 * registration wiring that makes the plugin-page card visible: factory shape,
 * apply effects, slot registration options (key = package name — the
 * configured-ledger gate), form controller binding, and the b1 fan-out ops.
 *
 * @module dsh-mm-resilience/tests/client.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

function fakeReact() {
  const { createElement, useState, useSyncExternalStore } = {
 createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
  return { createElement, useState, useSyncExternalStore }
}

let loadedClient
function loadClient() {
  if (loadedClient !== undefined) return loadedClient
  let captured
  globalThis.window = { __ModuleLoader__: { load: (registration) => { captured = registration } } }
  globalThis.document = {
    createElement: () => ({ dataset: {}, style: {}, textContent: '', append () {}, remove () {} }),
    head: { append () {} },
  }
  const require = (specifier) => {
    if (specifier === 'react') return fakeReact()
    throw new Error(`unexpected require: ${specifier}`)
  }
  loadedClient = (async () => {
    await import(pathToFileURL(path.join(root, 'client/index.js')).href)
    return { registration: captured, moduleExports: captured.factory(require) }
  })()
  return loadedClient
}

test('factory: registers with the package-name id and returns apply/inject', async () => {
  const { registration, moduleExports } = await loadClient()
  assert.equal(registration.id, 'dsh-mm-resilience')
  assert.equal(typeof registration.factory, 'function')
  assert.equal(typeof moduleExports.apply, 'function')
  assert.deepEqual(moduleExports.inject, ['slots', 'locale', 'configForms'])
})

test('apply: registers locale dict, injects page style, and binds the plugins.bundle.config card unconditionally', async () => {
  const { moduleExports } = await loadClient()
  const effectLabels = []
  const slotInjections = []
  let localeDict
  let styleInjected = false
  const ctx = {
    locale: {
      bind: () => (key) => key,
      register: (ns, dict) => { localeDict = dict },
    },
    configForms: {
      get: (ns) => formFor(ns),
    },
    slots: {
      inject: (name, register, label) => {
        slotInjections.push({ name, label })
        return register()
      },
      register: (options, render) => ({ options, render }),
    },
    effect: (fn, label) => {
      if (typeof label === 'string') effectLabels.push(label)
      const dispose = fn()
      if (label === undefined) styleInjected = true
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  moduleExports.apply(ctx)

  assert.deepEqual(Object.keys(localeDict).sort(), ['en', 'zh'])
  assert.ok(styleInjected, 'page style effect ran')
  assert.deepEqual(effectLabels, ['mm-resilience: plugins card form subscription'])
  assert.equal(slotInjections.length, 1)
  assert.equal(slotInjections[0].name, 'plugins.bundle.config')
  assert.equal(slotInjections[0].label, 'mm-resilience: plugins page card')
})

test('apply: slot registration options carry key = package name; summary view renders text', async () => {
  const { moduleExports } = await loadClient()
  let slotRegistration
  const ctx = {
    locale: { bind: () => (key) => key, register: () => {} },
    configForms: { get: () => formFor('mm-resilience') },
    slots: {
      inject: (name, register) => register(),
      register: (options, render) => { slotRegistration = { options, render } },
    },
    effect: (fn) => fn(),
  }
  moduleExports.apply(ctx)
  assert.equal(slotRegistration.options.name, 'plugins.bundle.config')
  assert.equal(slotRegistration.options.key, 'dsh-mm-resilience')
  assert.equal(typeof slotRegistration.render, 'function')
  const summary = slotRegistration.render({ view: 'summary' })
  assert.equal(typeof summary.type, 'string')
})

test('fanOutPixelBudget: providers-keys-only, revision-fenced atomic ops, single conflict retry', async () => {
  const { moduleExports } = await loadClient()
  const calls = []
  let revision = 3
  let failOnce = true
  const llmForm = {
    getSnapshot: () => ({
      status: 'ready',
      revision,
      value: { providers: { sz: {}, openai: {} } },
    }),
    subscribe: () => () => {},
    mutate: async (ops, expectedRevision) => {
      calls.push({ ops, expectedRevision })
      if (failOnce && expectedRevision === 3) {
        failOnce = false
        revision = 4 // concurrent writer bumped it
        return false
      }
      if (expectedRevision !== revision) return false
      revision += 1
      return true
    },
  }
  const ctx = { configForms: { get: (ns) => (ns === 'llm-pi-ai' ? llmForm : undefined) } }
  const result = await moduleExports.fanOutPixelBudget(ctx, 262144)
  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  assert.equal(calls.length, 2, 'one re-read retry after the first conflict')
  assert.deepEqual(calls[1].ops, [
    { op: 'set', path: ['providers', 'sz', 'requestImagePixelBudget'], value: 262144 },
    { op: 'set', path: ['providers', 'openai', 'requestImagePixelBudget'], value: 262144 },
  ])
  assert.equal(calls[1].expectedRevision, 4, 'retry re-read the bumped revision')
})

test('fanOutPixelBudget: no providers and unavailable namespace are honest skips', async () => {
  const { moduleExports } = await loadClient()
  const emptyForm = {
    getSnapshot: () => ({ status: 'ready', revision: 1, value: { providers: {} } }),
    subscribe: () => () => {},
    mutate: async () => true,
  }
  assert.deepEqual(
    await moduleExports.fanOutPixelBudget({ configForms: { get: () => emptyForm } }, 1),
    { ok: false, reason: 'no-providers' },
  )
  assert.deepEqual(
    await moduleExports.fanOutPixelBudget({ configForms: { get: () => undefined } }, 1),
    { ok: false, reason: 'unavailable' },
  )
})

test('fanOutPixelBudget: a second consecutive conflict is returned, not retried forever', async () => {
  const { moduleExports } = await loadClient()
  const calls = []
  const alwaysConflict = {
    getSnapshot: () => ({ status: 'ready', revision: 9, value: { providers: { a: {} } } }),
    subscribe: () => () => {},
    mutate: async (ops, expectedRevision) => { calls.push(expectedRevision); return false },
  }
  const result = await moduleExports.fanOutPixelBudget({ configForms: { get: () => alwaysConflict } }, 42)
  assert.deepEqual(result, { ok: false, reason: 'conflict' })
  assert.equal(calls.length, 2)
})

function formFor(ns) {
  const listeners = new Set()
  const value = {
    enabled: true,
    maxImagePixels: 1048576,
    maxDescribedPerMessage: 8,
    describeProvider: '',
    describeModel: '',
    describeConcurrency: 4,
    describeTimeoutMs: 10000,
    describeTotalBudgetMs: 15000,
  }
  let revision = 7
  const mutateCalls = []
  return {
    mutateCalls,
    getSnapshot: () => ({ status: 'ready', value, revision }),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    mutate: async (ops, expectedRevision) => {
      mutateCalls.push({ ops, expectedRevision })
      if (expectedRevision !== revision) return false
      revision += 1
      for (const op of ops) value[op.path[0]] = op.value
      for (const listener of listeners) listener()
      return true
    },
  }
}
