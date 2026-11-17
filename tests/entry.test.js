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

test('pre-step: claimed images archived with description tag on the session route', async () => {
  const ctx = fakeContext()
  apply(ctx, {})
  const decision = await runPreStep(ctx)
  assert.equal(decision.kind, 'enter')
  const content = decision.messages[0].content
  assert.equal(content[1].offloaded, true)
  assert.equal(content[2].type, 'text')
  assert.match(content[2].text, /机器解析（sz\/vl/)
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

test('pre-step: text-only session route archives without description (honest unavailability)', async () => {
  const ctx = fakeContext({ llm: fakeLlm({ capable: false }) })
  apply(ctx, {})
  const decision = await runPreStep(ctx)
  assert.equal(decision.messages[0].content[1].offloaded, true)
  assert.match(decision.messages[0].content[2].text, /未解析（/)
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
  const fullTags = full.messages[0].content.filter((block) => block.type === 'text' && block.text.includes('图片已归档'))
  assert.equal(fullTags.length, 2)
  assert.match(fullTags[0].text, /机器解析/)
  assert.match(fullTags[1].text, /机器解析/, 'cap 20: both images described')

  config.maxDescribedPerMessage = 1
  const capped = await invoke()
  const cappedTags = capped.messages[0].content.filter((block) => block.type === 'text' && block.text.includes('图片已归档'))
  assert.equal(cappedTags.length, 2)
  assert.match(cappedTags[1].text, /未解析（超出每条消息解析上限/, 'live cap 1: second image archives without description')
})

test('exports: plugin surface (apply + schemastery Config with official defaults)', async () => {
  assert.equal(typeof apply, 'function')
  assert.equal(Config({}).maxImagePixels.get(), 4_194_304)
})
