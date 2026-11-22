/**
 * Host-half entry wiring: the pre-step archive listener (egress pass +
 * hybrid claimed-batch rewrite with bounded describe on the session's own
 * route) and the conditional mm_view_image registration. The bundle's
 * Plugins-page switch is the only on/off — apply registers everything
 * unconditionally and no per-event enable gate exists.
 *
 * @module dsh-mm-resilience/tests/entry.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, Config } from '../src/index.js'

const ref = (attachmentId) => ({ attachmentId, mediaType: 'image/png', width: 10, height: 10, bytes: 5 })

function fakeLlm({ capable = true } = {}) {
  return {
    async resolveModelInfo() {
      return { inputModalities: capable ? ['text', 'image'] : ['text'] }
    },
    async *stream() {
      yield { type: 'text-delta', index: 0, text: '描述X' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

function fakeContext({ llm = fakeLlm(), settings } = {}) {
  const listeners = new Map()
  const registeredTools = []
  const effects = []
  return {
    llm,
    listeners,
    registeredTools,
    effects,
    get: (name) => (name === 'settings' ? settings : undefined),
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    tools: {
      register(definition, options) {
        registeredTools.push({ definition, options })
        return () => {}
      },
    },
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose: typeof dispose === 'function' ? dispose : () => {} })
      return () => {}
    },
  }
}

const imageMessage = (attachmentId) => ({
  id: `m-${attachmentId}`,
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text: '看图' }, { type: 'image', attachment: ref(attachmentId) }],
})

async function runPreStep(ctx, payloadOverrides = {}, decisionOverrides = {}) {
  const listener = ctx.listeners.get('agent/pre-step')
  assert.ok(listener, 'pre-step listener registered')
  const payload = {
    agent: null,
    messages: [],
    turn: 1,
    step: 1,
    signal: new AbortController().signal,
    modelSelection: { provider: 'sz', model: 'vl' },
    ...payloadOverrides,
  }
  const next = async () => ({ kind: 'enter', messages: decisionOverrides.messages ?? [imageMessage('a')] })
  return listener(payload, next)
}

test('apply registers the pre-step listener and the route-gated tool unconditionally', () => {
  const ctx = fakeContext()
  apply(ctx, {})
  assert.ok(ctx.listeners.has('agent/pre-step'))
  assert.equal(ctx.registeredTools.length, 1)
  assert.equal(ctx.registeredTools[0].definition.name, 'mm_view_image')
  assert.equal(typeof ctx.registeredTools[0].options.when, 'function')
})

test('pre-step: user message stays native (offloaded mark only) + one context message carries descriptions', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const decision = await runPreStep(ctx)
  assert.equal(decision.kind, 'enter')
  // User message: original shape — no tag block inserted.
  const userMessage = decision.messages[0]
  assert.equal(userMessage.content.length, 2)
  assert.deepEqual(userMessage.content.map((b) => b.type), ['text', 'image'])
  assert.equal(userMessage.content[1].offloaded, true)
  assert.equal(userMessage.source.kind, 'user')
  // Context message: official injection classification.
  const archive = decision.messages[1]
  assert.equal(archive.role, 'user')
  assert.equal(archive.source.kind, 'mm-image-archive')
  assert.equal(archive.source.form, 'notice')
  assert.match(archive.content[0].text, /机器解析（sz\/vl/)
})

test('pre-step: reject decisions pass through untouched', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const listener = ctx.listeners.get('agent/pre-step')
  const decision = await listener(
    { agent: null, messages: [], turn: 1, step: 1, signal: new AbortController().signal, modelSelection: { provider: 'sz', model: 'vl' } },
    async () => ({ kind: 'reject' }),
  )
  assert.deepEqual(decision, { kind: 'reject' })
})

test('pre-step: egress failures are tolerated and the rewrite still applies', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const session = {
    surface: { nodes: [1] },
    eventAt: () => {
      throw new Error('storage hiccup')
    },
    append: () => {},
  }
  const decision = await runPreStep(ctx, { agent: { session } })
  assert.equal(decision.messages[0].content[1].offloaded, true)
})

test('pre-step: text-only route archives with NO context message (zero front-end footprint)', async () => {
  const ctx = fakeContext({ llm: fakeLlm({ capable: false }) })
  apply(ctx, {})
  const decision = await runPreStep(ctx)
  assert.equal(decision.messages[0].content[1].offloaded, true)
  assert.equal(decision.messages.length, 1, 'no archive row when nothing was described')
})

test('pre-step: runtime-context messages are left for the loop to re-project', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const runtimeContextMessage = {
    id: 'rc',
    role: 'user',
    source: { kind: 'runtime-context' },
    content: [{ type: 'image', attachment: ref('rc-img') }],
  }
  const decision = await runPreStep(ctx, {}, { messages: [runtimeContextMessage, imageMessage('a')] })
  assert.equal(decision.messages[0], runtimeContextMessage)
  assert.equal(decision.messages[1].content[1].offloaded, true)
  assert.equal(decision.messages[2].source.kind, 'mm-image-archive', 'archive row still follows described images')
})

test('liveness: editing maxDescribedPerMessage on the live config object takes effect on the next event', async () => {
  const config = { maxDescribedPerMessage: 20, describeConcurrency: 4, maxImagePixels: 4_194_304 }
  const ctx = fakeContext()
  apply(ctx, config)
  const twoImages = imageMessage('a')
  twoImages.content = [...twoImages.content, { type: 'image', attachment: ref('b') }]
  const listener = ctx.listeners.get('agent/pre-step')
  const payload = {
    agent: null, messages: [], turn: 1, step: 1,
    signal: new AbortController().signal,
    modelSelection: { provider: 'sz', model: 'vl' },
  }
  const invoke = () => listener(payload, async () => ({ kind: 'enter', messages: [twoImages] }))

  const full = await invoke()
  const fullRow = full.messages[1]
  assert.equal(fullRow.source.kind, 'mm-image-archive', 'archive row present')
  assert.match(fullRow.content[0].text, /a/, 'cap 20: first image described')
  assert.match(fullRow.content[0].text, /b/, 'cap 20: second image described too')


  config.maxDescribedPerMessage = 1
  const capped = await invoke()
  const archiveRow = capped.messages[1]
  assert.equal(archiveRow.source.kind, 'mm-image-archive')
  assert.match(archiveRow.content[0].text, /机器解析/, 'live cap 1: only the first image described')
  assert.equal(archiveRow.content[0].text.includes(') b '), false, 'second image absent from the row')
})

test('handover: apply reconciles takeover; dispose reverts to official default', async () => {
  const DEFAULT = 4_194_304
  const calls = []
  // Stateful fake: mutate applies ops into the user layer describe projects.
  const state = { providers: { sz: { requestImagePixelBudget: DEFAULT } }, userProviders: {} }
  const settings = {
    describe: () => [{
      ns: 'llm-pi-ai',
      revision: 11,
      value: { providers: state.providers },
      user: { providers: state.userProviders },
      base: { providers: { sz: { requestImagePixelBudget: DEFAULT } } },
    }],
    mutate: async (ns, ops, revision) => {
      calls.push({ ns, ops, revision })
      for (const op of ops) {
        const [, route, field] = op.path
        state.userProviders[route] ??= {}
        if (op.op === 'set') state.userProviders[route][field] = op.value
        else delete state.userProviders[route][field]
      }
    },
  }
  const config = { maxImagePixels: 1_048_576, maxDescribedPerMessage: 20, describeConcurrency: 4 }

  // Custom budget: apply fills the absent sz row (takeover).
  let ctx = fakeContext({ settings })
  apply(ctx, config)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, [{ ns: 'llm-pi-ai', revision: 11, ops: [{ op: 'set', path: ['providers', 'sz', 'requestImagePixelBudget'], value: 1_048_576 }] }])

  // Disable (fiber destroy): the row we just applied (still equal to our
  // value) is handed back to the official default.
  const dispose = ctx.effects.find((entry) => entry.label === 'mm-resilience: pixel-budget handover')?.dispose
  assert.ok(dispose, 'handover dispose effect registered')
  dispose()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls.at(-1).ops, [{ op: 'unset', path: ['providers', 'sz', 'requestImagePixelBudget'] }])
  assert.equal(state.userProviders.sz.requestImagePixelBudget, undefined, 'row returned to official inherit')

  // Default budget: apply performs no takeover write (no churn on restart);
  // a second disable with the default effective finds no matching row.
  calls.length = 0
  ctx = fakeContext({ settings })
  apply(ctx, { ...config, maxImagePixels: DEFAULT })
  await new Promise((resolve) => setTimeout(resolve, 0))
  ctx.effects.find((entry) => entry.label === 'mm-resilience: pixel-budget handover').dispose()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(calls.length, 0)
})

test('exports: plugin surface (apply + schemastery Config with official defaults)', async () => {
  assert.equal(typeof apply, 'function')
  assert.equal(Config({}).maxImagePixels.get(), 4_194_304)
})
