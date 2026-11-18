/**
 * V1 ROOT-CAUSE REPRO: drives the factory card's EXACT wiring with the REAL
 * official SettingsFormModel (compiled from the published TypeScript source)
 * and a REAL-semantic fake scope, through a minimal stateful hooks runtime.
 * Scenarios: initial disabled save → edit→dirty → save→landed/overridden →
 * reset→unset→official default restored → invalid draft blocks save.
 *
 * The npm bundle itself cannot load under node (ambient-dependency barrel),
 * so the factory's `require('@deepseek-ai/dsh-client-ui-primitives')` is fed
 * the REAL compiled model/field helpers plus stub presentational components;
 * every behavior under test (staging/shell/save/reset) is the official code.
 *
 * Run with the stub loader: node --loader ./tests/stub-css-loader.mjs --test tests/
 *
 * @module dsh-mm-resilience/tests/repro-form-model.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const realFormModel = await import(pathToFileURL(path.join(root, '.compiled/form-model.js')).href)

/* ------------------------------------------------------------------ *
 * Minimal stateful hooks runtime: enough React for the Card to stage,
 * re-render on notify, and expose the official shell/field/action props.
 * ------------------------------------------------------------------ */
function createMiniReact() {
  const slots = []
  const state = { cursor: 0, element: null, tree: null, subscribed: false }
  /** Reset hook state so each test mounts a fresh Card instance. */
  function reset() {
    slots.length = 0
    state.cursor = 0
    state.element = null
    state.tree = null
    state.subscribed = false
  }

  const react = {
    // Capture only — mount/rerender drive function components so hooks run.
    createElement(type, props, ...children) {
      return { type, props: { ...props, ...(children.length === 0 ? {} : { children: children.length === 1 ? children[0] : children }) } }
    },
    useEffect() { /* dispose bookkeeping not needed for the repro */ },
    useState(initial) {
      const index = state.cursor
      state.cursor += 1
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (value) => {
        slots[index] = typeof value === 'function' ? value(slots[index]) : value
      }]
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      if (!state.subscribed) {
        state.subscribed = true
        subscribe(() => { if (state.element) rerender() })
      }
      return getSnapshot()
    },
  }

  function rerender() {
    if (state.element === null) return null
    state.cursor = 0
    state.tree = state.element.type(state.element.props)
    return state.tree
  }

  function mount(element) {
    state.element = element
    return rerender()
  }

  Object.assign(react, { mount, rerender, mounted: () => state.tree, reset })
  return react
}

/* ------------------------------------------------------------------ *
 * Fake scope with REAL SettingsFormScopeSnapshot semantics.
 * ------------------------------------------------------------------ */
function createFakeScope(initialValue) {
  const listeners = new Set()
  const state = {
    status: 'ready',
    value: { ...initialValue },
    base: {},
    user: {},
    writable: true,
    revision: 1,
  }
  const mutateCalls = []
  const scope = {
    mutateCalls,
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mutate: async (ops, expectedRevision) => {
      mutateCalls.push({ ops: structuredClone(ops), expectedRevision })
      if (expectedRevision !== undefined && expectedRevision !== state.revision) return false
      state.revision += 1
      for (const op of ops) {
        if (op.op === 'set') state.user[op.path[0]] = op.value
        else delete state.user[op.path[0]]
      }
      // The Host re-projects value = defaults over user layer.
      state.value = { ...initialValue, ...state.user }
      for (const listener of listeners) listener()
      return true
    },
  }
  return scope
}

/* Load the factory once, feeding the REAL compiled model + stub components. */
let loaded
async function loadFactory() {
  if (loaded !== undefined) return loaded
  let captured
  globalThis.window = { __ModuleLoader__: { load: (registration) => { captured = registration } } }
  globalThis.document = {
    createElement: () => ({ dataset: {}, style: {}, textContent: '', append () {}, remove () {} }),
    head: { append () {} },
  }
  const miniReact = createMiniReact()
  const stub = (name) => () => ({ type: name })
  const primitives = {
    SettingsFormModel: realFormModel.SettingsFormModel,
    settingsNumberField: realFormModel.settingsNumberField,
    SettingsForm: stub('SettingsForm'),
    SettingsValueField: stub('SettingsValueField'),
    Tooltip: stub('Tooltip'),
    IconInfoOutlineRegular: stub('IconInfoOutlineRegular'),
  }
  const require = (specifier) => {
    if (specifier === 'react') return miniReact
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${specifier}`)
  }
  loaded = (async () => {
    await import(pathToFileURL(path.join(root, 'client/index.js')).href)
    return { registration: captured, moduleExports: captured.factory(require), miniReact }
  })()
  return loaded
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  visit(node)
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, visit)
  if (node.props && Array.isArray(node.props.children)) walk(node.props.children, visit)
  if (node.props && node.props.children && !Array.isArray(node.props.children)) walk(node.props.children, visit)
}

async function mountCard(preparedScope) {
  const { moduleExports, miniReact } = await loadFactory()
  miniReact.reset()
  const scope = preparedScope ?? createFakeScope({ maxImagePixels: 4_194_304, maxDescribedPerMessage: 20, describeConcurrency: 4 })
  const registrations = []
  const ctx = {
    locale: { bind: () => (key) => key, register: () => {} },
    configForms: { get: (ns) => (ns === 'mm-resilience' ? scope : undefined) },
    slots: {
      inject: (name, register) => register(),
      register: (options, render) => registrations.push({ options, render }),
    },
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  moduleExports.apply(ctx)
  miniReact.mount(registrations[0].render({ view: 'page' }))
  // Function components are captured, not invoked: identify them structurally
  // (the official SettingsForm carries state+labels; our fields carry mmrr- ids).
  const query = () => {
    const forms = []
    const fields = []
    walk(miniReact.mounted(), (node) => {
      if (typeof node.type === 'function' && node.props.state !== undefined && node.props.labels !== undefined) forms.push(node)
      if (typeof node.type === 'function' && typeof node.props.id === 'string' && node.props.id.startsWith('mmrr-') && typeof node.props.onEdit === 'function') fields.push(node)
    })
    return { form: forms[0], fields }
  }
  return { scope, miniReact, query }
}

test('V1.A initial: save disabled (not dirty), fields show official defaults', async () => {
  const { query } = await mountCard()
  const { form, fields } = query()
  assert.equal(fields.length, 3)
  assert.deepEqual(fields.map((f) => f.props.text), ['4194304', '20', '4'])
  assert.equal(form.props.state.dirty, false)
  assert.equal(form.props.state.available, true)
})

test('V1.B edit → dirty → save lands ops → drafts clear → overridden true', async () => {
  const { scope, miniReact, query } = await mountCard()
  let { fields } = query()
  const pixels = fields.find((f) => f.props.id === 'mmrr-pixels')
  pixels.props.onEdit('262144')
  miniReact.rerender()
  ;({ fields } = query())
  assert.equal(fields.find((f) => f.props.id === 'mmrr-pixels').props.text, '262144')
  let { form } = query()
  assert.equal(form.props.state.dirty, true, 'save enables after an edit')

  await form.props.onSave()
  miniReact.rerender()
  assert.equal(scope.mutateCalls.length, 1, 'one revision-fenced mutate')
  assert.deepEqual(scope.mutateCalls[0].ops, [{ op: 'set', path: ['maxImagePixels'], value: 262144 }])
  assert.equal(scope.mutateCalls[0].expectedRevision, 1)
  assert.equal(scope.getSnapshot().value.maxImagePixels, 262144, 'landed in the section')
  ;({ form, fields } = query())
  assert.equal(form.props.state.dirty, false, 'drafts cleared after landing')
  assert.equal(fields.find((f) => f.props.id === 'mmrr-pixels').props.overridden, true, 'official 恢复默认 affordance now appears')
})

test('V1.C reset → clear op → user layer emptied → official default restored', async () => {
  const { scope, miniReact, query } = await mountCard()
  let { fields } = query()
  fields.find((f) => f.props.id === 'mmrr-pixels').props.onEdit('262144')
  let { form } = query()
  await form.props.onSave()
  miniReact.rerender()

  ;({ fields } = query())
  fields.find((f) => f.props.id === 'mmrr-pixels').props.onReset()
  miniReact.rerender()
  ;({ form } = query())
  assert.equal(form.props.state.dirty, true, 'a staged clear marks the form dirty')
  await form.props.onSave()
  miniReact.rerender()
  const resetCall = scope.mutateCalls.at(-1)
  assert.deepEqual(resetCall.ops, [{ op: 'unset', path: ['maxImagePixels'] }], 'reset writes the official unset op')
  assert.equal(scope.getSnapshot().value.maxImagePixels, 4_194_304, 'official default re-inherited')
  ;({ fields } = query())
  assert.equal(fields.find((f) => f.props.id === 'mmrr-pixels').props.overridden, false, 'override gone — 恢复默认 disappears (official semantics)')
})

test('V1.D invalid draft blocks save (out-of-bounds via our boundedField)', async () => {
  const { scope, miniReact, query } = await mountCard()
  let { fields } = query()
  fields.find((f) => f.props.id === 'mmrr-pixels').props.onEdit('99999999')
  miniReact.rerender()
  const snapshot = query()
  const form = snapshot.form
  fields = snapshot.fields
  const pixels = fields.find((f) => f.props.id === 'mmrr-pixels')
  assert.equal(pixels.props.invalid, true, 'boundedField flags out-of-range inline')
  assert.equal(form.props.state.invalid, true, 'shell blocks the save')
  await form.props.onSave()
  assert.equal(scope.mutateCalls.length, 0, 'no write escaped')
})

test('V1.E revision conflict keeps drafts (failed state) — official resilience', async () => {
  const scope = createFakeScope({ maxImagePixels: 4_194_304, maxDescribedPerMessage: 20, describeConcurrency: 4 })
  // Simulate a concurrent writer between read and save.
  const originalMutate = scope.mutate.bind(scope)
  scope.mutate = async (ops, rev) => {
    if (scope.mutateCalls.length === 0) {
      scope.getSnapshot().revision = 99
    }
    return originalMutate(ops, rev)
  }
  const { miniReact, query } = await mountCard(scope)
  let { fields } = query()
  fields.find((f) => f.props.id === 'mmrr-pixels').props.onEdit('262144')
  let { form } = query()
  await form.props.onSave()
  miniReact.rerender()
  ;({ form } = query())
  assert.equal(form.props.state.failed, true, 'conflict surfaces the official saveFailed state')
  assert.equal(form.props.state.dirty, true, 'drafts retained for correction')
})

test('V1.F StrictMode/remount safety: hoisted controller survives remount; edits still notify; save lands', async () => {
  const { moduleExports, miniReact } = await loadFactory()
  miniReact.reset()
  const scope = createFakeScope({ maxImagePixels: 4_194_304, maxDescribedPerMessage: 20, describeConcurrency: 4 })
  const registrations = []
  const ctx = {
    locale: { bind: () => (key) => key, register: () => {} },
    configForms: { get: (ns) => (ns === 'mm-resilience' ? scope : undefined) },
    slots: {
      inject: (name, register) => register(),
      register: (options, render) => registrations.push({ options, render }),
    },
    effect: (fn) => {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
  }
  moduleExports.apply(ctx)
  // First mount.
  miniReact.mount(registrations[0].render({ view: 'page' }))
  // Simulated unmount + remount (React StrictMode replay / page navigation):
  // the controller is a prop — plugin lifetime, never disposed by the card.
  miniReact.reset()
  miniReact.mount(registrations[0].render({ view: 'page' }))

  const fieldsOf = () => {
    const fields = []
    walk(miniReact.mounted(), (node) => {
      if (typeof node.type === 'function' && String(node.props.id ?? '').startsWith('mmrr-') && typeof node.props.onEdit === 'function') fields.push(node)
    })
    return fields
  }
  const formOf = () => {
    let form
    walk(miniReact.mounted(), (node) => {
      if (typeof node.type === 'function' && node.props.state !== undefined && node.props.labels !== undefined) form = node
    })
    return form
  }

  fieldsOf().find((f) => f.props.id === 'mmrr-pixels').props.onEdit('262144')
  miniReact.rerender()
  assert.equal(formOf().props.state.dirty, true, 'edits still re-render after remount')
  await formOf().props.onSave()
  miniReact.rerender()
  assert.equal(scope.mutateCalls.length, 1, 'save lands through the surviving controller')
  assert.equal(formOf().props.state.dirty, false)
})
