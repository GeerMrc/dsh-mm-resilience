/**
 * Host-half entry: registers the `agent/pre-step` archive listener (egress
 * pass + hybrid claimed-batch rewrite with bounded describe) on an
 * image-capable route. Pure prevention, zero remediation: no failure
 * classification, no reactive ladder. `enabled: false` leaves the plugin
 * fully passive (no listener, no tool) — official behavior.
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

function fakeContext({ llm = fakeLlm() } = {}) {
  const listeners = new Map()
  const registeredTools = []
  return {
    llm,
    listeners,
    registeredTools,
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
  }
}

const imageMessage = {
  id: 'm1',
  role: 'user',
  source: { kind: 'user' },
  content: [{ type: 'text', text: '看图' }, { type: 'image', attachment: ref('a') }],
}

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
  const next = async () => ({ kind: 'enter', messages: decisionOverrides.messages ?? [imageMessage] })
  return listener(payload, next)
}

test('apply always registers the listener and tool; enabled gates per event', () => {
  const off = fakeContext()
  apply(off, { enabled: true })
  assert.ok(off.listeners.has('agent/pre-step'))
  assert.equal(off.registeredTools.length, 1)
  assert.equal(off.registeredTools[0].definition.name, 'mm_view_image')
  assert.equal(typeof off.registeredTools[0].options.when, 'function')

  // Registrations stay mounted when disabled (volatile commits in place
  // without re-running apply); the per-event gate makes the plugin inert.
  const disabled = fakeContext()
  apply(disabled, { enabled: { get: () => false } })
  assert.ok(disabled.listeners.has('agent/pre-step'))
  assert.equal(disabled.registeredTools.length, 1)
})

test('liveness: toggling enabled on the live config object takes effect on the next event', async () => {
  const config = { enabled: true }
  const ctx = fakeContext()
  apply(ctx, config)
  const listener = ctx.listeners.get('agent/pre-step')
  const payload = {
    agent: null, messages: [], turn: 1, step: 1,
    signal: new AbortController().signal,
    modelSelection: { provider: 'sz', model: 'vl' },
  }
  const next = async () => ({ kind: 'enter', messages: [imageMessage] })

  config.enabled = false
  const inert = await listener(payload, next)
  assert.equal(inert.messages[0], imageMessage, 'disabled: claimed batch untouched (same object)')

  config.enabled = true
  const active = await listener(payload, next)
  assert.equal(active.messages[0].content[1].offloaded, true, 're-enabled: rewrite applies')
})

test('pre-step: claimed images archived with description tag; decision fields spread', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const decision = await runPreStep(ctx)
  assert.equal(decision.kind, 'enter')
  assert.equal(decision.messages.length, 1)
  const content = decision.messages[0].content
  assert.equal(content[1].offloaded, true)
  assert.equal(content[2].type, 'text')
  assert.match(content[2].text, /机器解析（sz\/vl/)

  const egressCtx = fakeContext()
  apply(egressCtx, {})
  // decision passthrough when no images
  const passthrough = await runPreStep(egressCtx, {}, { messages: [{ id: 'x', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '纯文本' }] }] })
  assert.equal(passthrough.messages[0].content[0].text, '纯文本')
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

test('pre-step: egress pass runs before next() and failures are tolerated', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const appends = []
  const session = {
    surface: { nodes: [1] },
    eventAt: () => {
      throw new Error('storage hiccup')
    },
    append: (...args) => appends.push(args),
  }
  const decision = await runPreStep(ctx, { agent: { session } })
  // egress threw, warn-only; rewrite still applied
  assert.equal(decision.messages[0].content[1].offloaded, true)
  assert.equal(appends.length, 0)
})

test('pre-step: text-only route archives without description', async () => {
  const ctx = fakeContext({ llm: fakeLlm({ capable: false }) })
  apply(ctx, {})
  const decision = await runPreStep(ctx)
  assert.equal(decision.messages[0].content[1].offloaded, true)
  assert.match(decision.messages[0].content[2].text, /未解析（/)
})

test('pre-step: explicit describe route overrides the session route', async () => {
  const seen = []
  const llm = fakeLlm()
  const originalStream = llm.stream.bind(llm)
  llm.stream = async function* (options) {
    seen.push(`${options.provider}/${options.model}`)
    yield* originalStream(options)
  }
  const ctx = fakeContext({ llm })
  apply(ctx, { describeProvider: 'aux', describeModel: 'vl-aux' })
  await runPreStep(ctx)
  assert.deepEqual(seen, ['aux/vl-aux'])
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
  const decision = await runPreStep(ctx, {}, { messages: [runtimeContextMessage, imageMessage] })
  // runtime-context message untouched (same object identity)
  assert.equal(decision.messages[0], runtimeContextMessage)
  assert.equal(decision.messages[1].content[1].offloaded, true)
})

test('exports: plugin surface (apply + schemastery Config) for the loader', async () => {
  assert.equal(typeof apply, 'function')
  assert.equal(Config({}).enabled.get(), true)
})
