/**
 * Client-half smoke test: executes the prebuilt factory exactly the way the
 * browser would (window.__ModuleLoader__.load capture → factory(require) →
 * apply(fakeCtx) → render('page'/'summary')) with fake react and a faithful
 * fake of the ui-primitives surface the card consumes, asserting the wiring
 * that makes the official-flat card visible: factory shape, unconditional
 * plugins.bundle.config registration (key = package name), official
 * component usage (SettingsForm/SettingsValueField/Tooltip present in the
 * tree), no hand-drawn control chrome, and the b1 fan-out ops (set + unset
 * restore-official path).
 *
 * @module dsh-mm-resilience/tests/client.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

/** Depth-first element visitor over captured createElement trees. */
function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  const children = node.props?.children ?? node.children
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit)
  } else if (children && typeof children === 'object') {
    walk(children, visit)
  }
}

function fakeReact() {
  return {
    // Function components are invoked eagerly (with children folded into
    // props, React-style) so nested official components record their calls.
    createElement: (type, props, ...children) => {
      const merged = children.length === 0
        ? { ...props }
        : { ...props, children: children.length === 1 ? children[0] : children }
      if (typeof type === 'function') return type(merged)
      return { type, props: merged, children: children.length === 1 ? [children[0]] : children }
    },
    useEffect: () => {},
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
}

/** Faithful-enough fake of the ui-primitives surface the card consumes. */
function fakePrimitives() {
  const calls = { fields: [], forms: [], tooltips: [] }
  const SettingsForm = (props) => {
    calls.forms.push(props)
    return { type: 'SettingsForm', props, children: props.children }
  }
  const SettingsValueField = (props) => {
    calls.fields.push(props)
    return { type: 'SettingsValueField', props }
  }
  class SettingsFormModel {
    constructor(scope, specs) {
      this.scope = scope
      this.specs = specs
    }
    bind(project) {
      return { getSnapshot: project, subscribe: () => () => {} }
    }
    shell() {
      const snapshot = this.scope.getSnapshot()
      return { available: snapshot.status === 'ready', writable: snapshot.writable !== false, dirty: false, invalid: false, saving: false, failed: false }
    }
    field(field) {
      const snapshot = this.scope.getSnapshot()
      return { text: String(snapshot.value?.[field] ?? ''), overridden: false, invalid: false }
    }
    actions() {
      return { edit: () => {}, resetField: () => {}, save: async () => {}, discard: () => {} }
    }
    async save() {}
    dispose() {}
  }
  const settingsNumberField = (field) => ({ field, format: (v) => String(v), parse: (t) => ({ kind: 'set', value: Number(t) }) })
  const Tooltip = (props) => {
    calls.tooltips.push(props)
    return { type: 'Tooltip', props, children: props.children }
  }
  const IconInfoOutlineRegular = (props) => ({ type: 'IconInfoOutlineRegular', props })
  return { calls, SettingsForm, SettingsValueField, SettingsFormModel, settingsNumberField, Tooltip, IconInfoOutlineRegular }
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
  const react = fakeReact()
  const primitives = fakePrimitives()
  const require = (specifier) => {
    if (specifier === 'react') return react
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${specifier}`)
  }
  loadedClient = (async () => {
    await import(pathToFileURL(path.join(root, 'client/index.js')).href)
    return { registration: captured, moduleExports: captured.factory(require), primitives }
  })()
  return loadedClient
}

function formFor(ns) {
  const listeners = new Set()
  const value = ns === 'mm-resilience'
    ? { maxImagePixels: 4_194_304, maxDescribedPerMessage: 20, describeConcurrency: 4 }
    : { providers: { sz: {}, openai: {} } }
  let revision = 7
  const mutateCalls = []
  return {
    mutateCalls,
    getSnapshot: () => ({ status: 'ready', value, revision, writable: true }),
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    mutate: async (ops, expectedRevision) => {
      mutateCalls.push({ ops, expectedRevision })
      if (expectedRevision !== revision) return false
      revision += 1
      for (const op of ops) {
        if (op.op === 'unset') {
          let node = value
          for (let i = 0; i < op.path.length - 1; i += 1) node = node[op.path[i]]
          delete node[op.path[op.path.length - 1]]
        } else {
          let node = value
          for (let i = 0; i < op.path.length - 1; i += 1) node = node[op.path[i]]
          node[op.path[op.path.length - 1]] = op.value
        }
      }
      for (const listener of listeners) listener()
      return true
    },
  }
}

function fakeCtx({ forms = {} } = {}) {
  const registrations = []
  const ctx = {
    locale: { bind: () => (key) => key, register: () => {} },
    configForms: { get: (ns) => forms[ns] ?? formFor(ns) },
    slots: {
      inject: (name, register) => register(),
      register: (options, render) => { registrations.push({ options, render }) },
    },
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  return { ctx, registrations }
}

test('factory: package-name id, apply/inject exports', async () => {
  const { registration, moduleExports } = await loadClient()
  assert.equal(registration.id, 'dsh-mm-resilience')
  assert.equal(typeof moduleExports.apply, 'function')
  assert.deepEqual(moduleExports.inject, ['slots', 'locale', 'configForms'])
})

test('apply: unconditional plugins.bundle.config registration keyed by package name', async () => {
  const { moduleExports } = await loadClient()
  const { ctx, registrations } = fakeCtx()
  moduleExports.apply(ctx)
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'plugins.bundle.config')
  assert.equal(registrations[0].options.key, 'dsh-mm-resilience')
})

test('page view renders the official SettingsForm + SettingsValueField tree with Tooltip ⓘ', async () => {
  const { moduleExports, primitives } = await loadClient()
  const { ctx, registrations } = fakeCtx()
  moduleExports.apply(ctx)
  // The fake createElement invokes Card eagerly (hooks are synchronous), so
  // the page render returns the fully rendered div tree.
  const tree = registrations[0].render({ view: 'page' })
  assert.equal(tree.type, 'div')
  const form = tree.children[0]
  assert.equal(form.type, 'SettingsForm')
  assert.equal(typeof form.props.onSave, 'function')
  assert.equal(typeof form.props.onDiscard, 'function')
  assert.deepEqual(Object.keys(form.props.labels).sort(), ['readOnly', 'save', 'saveFailed', 'saving', 'unavailable'])
  // one merged region (no section headings): a single grid of 3 cells, each
  // field label carrying its own hover ⓘ Tooltip inline.
  const grid = Array.isArray(form.children) ? form.children[0] : form.children
  assert.equal(grid.props.className, 'mmrr-limits', 'single merged grid child')
  assert.equal(primitives.calls.tooltips.length, 3, 'one hover ⓘ per field label')
  assert.equal(primitives.calls.fields.length, 3, 'pixels + count + concurrency official fields')
  const ids = primitives.calls.fields.map((f) => f.id).sort()
  assert.deepEqual(ids, ['mmrr-concurrency', 'mmrr-count', 'mmrr-pixels'])
  for (const field of primitives.calls.fields) {
    assert.equal(field.numeric, true)
    assert.equal(field.help, undefined, 'V4: no field-level ⓘ/expandable help')
    assert.equal(typeof field.hint, 'string', 'single-line hint remains')
    assert.equal(typeof field.onEdit, 'function')
    assert.equal(typeof field.onReset, 'function')
  }
  // each field wrapped in a .mmrr-cell (breaks the official .field + .field
  // sibling separator that produced the orphan half-width line)
  const cells = []
  walk(tree, (node) => { if (node.props?.className === 'mmrr-cell') cells.push(node) })
  assert.equal(cells.length, 3)
  // bottom: inline status note only (official hint styling) — the separate
  // re-apply control is gone; change+save re-applies to all routes.
  assert.equal(tree.children[1], null, 'no note rendered before any save')
})

test('summary view renders a plain one-liner span', async () => {
  const { moduleExports } = await loadClient()
  const { ctx, registrations } = fakeCtx()
  moduleExports.apply(ctx)
  const summary = registrations[0].render({ view: 'summary' })
  assert.equal(summary.type, 'span')
})

test('fan-out: set ops to every provider route, revision-fenced with one conflict retry', async () => {
  const { moduleExports } = await loadClient()
  const calls = []
  let revision = 3
  let failOnce = true
  const llmForm = {
    getSnapshot: () => ({ status: 'ready', revision, value: { providers: { sz: {}, openai: {} } } }),
    subscribe: () => () => {},
    mutate: async (ops, expectedRevision) => {
      calls.push({ ops, expectedRevision })
      if (failOnce && expectedRevision === 3) {
        failOnce = false
        revision = 4
        return false
      }
      if (expectedRevision !== revision) return false
      revision += 1
      return true
    },
  }
  const result = await moduleExports.fanOutPixelBudget({ configForms: { get: (ns) => (ns === 'llm-pi-ai' ? llmForm : undefined) } }, 262144)
  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].ops, [
    { op: 'set', path: ['providers', 'sz', 'requestImagePixelBudget'], value: 262144 },
    { op: 'set', path: ['providers', 'openai', 'requestImagePixelBudget'], value: 262144 },
  ])
  assert.equal(calls[1].expectedRevision, 4)
})

test('fan-out: budget === null emits UNSET ops (restore-official path)', async () => {
  const { moduleExports } = await loadClient()
  const llmForm = formFor('llm-pi-ai')
  const result = await moduleExports.fanOutPixelBudget({ configForms: { get: (ns) => (ns === 'llm-pi-ai' ? llmForm : undefined) } }, null)
  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  assert.deepEqual(llmForm.mutateCalls[0].ops, [
    { op: 'unset', path: ['providers', 'sz', 'requestImagePixelBudget'] },
    { op: 'unset', path: ['providers', 'openai', 'requestImagePixelBudget'] },
  ])
  assert.equal(llmForm.getSnapshot().value.providers.sz.requestImagePixelBudget, undefined, 'override deleted → official default re-inherited')
})

test('fan-out: honest skips for missing namespace / no providers / repeated conflict', async () => {
  const { moduleExports } = await loadClient()
  assert.deepEqual(await moduleExports.fanOutPixelBudget({ configForms: { get: () => undefined } }, 1), { ok: false, reason: 'unavailable' })
  const empty = formFor('llm-pi-ai')
  empty.getSnapshot = () => ({ status: 'ready', revision: 1, value: { providers: {} } })
  assert.deepEqual(await moduleExports.fanOutPixelBudget({ configForms: { get: () => empty } }, 1), { ok: false, reason: 'no-providers' })
  const alwaysConflict = {
    getSnapshot: () => ({ status: 'ready', revision: 9, value: { providers: { a: {} } } }),
    subscribe: () => () => {},
    mutate: async () => false,
  }
  const calls2 = []
  alwaysConflict.mutate = async (ops, rev) => { calls2.push(rev); return false }
  assert.deepEqual(
    await moduleExports.fanOutPixelBudget({ configForms: { get: () => alwaysConflict } }, 42),
    { ok: false, reason: 'conflict' },
  )
  assert.equal(calls2.length, 2)
})
