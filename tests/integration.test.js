/**
 * Contract-faithful integration harness: replays the REAL agent-loop ordering
 * (claim → pre-step waterfall → user/message append(surfaceOp append) →
 * request derivation) and the REAL surface replace validation rules (single
 * node, earlier seqs, content-only change, sourceEventSeqs) exactly as
 * extracted from agent.ts / surface.ts at f3803c9697, against the plugin's
 * listener. Asserts the core guarantee — from its very first request, a
 * pasted image never serializes as image bytes — plus egress, idempotence,
 * cap semantics, and plugin-disabled replayability.
 *
 * @module dsh-mm-resilience/tests/integration.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../src/index.js'
import { egressLiveToolImages } from '../src/egress.js'

const ref = (attachmentId, extra = {}) => ({
  attachmentId, mediaType: 'image/png', width: 800, height: 600, bytes: 12345, ...extra,
})

/** Fake llm service: image-capable, describe returns a fixed text. */
function fakeLlm({ capable = true, text = '一张截图：包含按钮与报错文案' } = {}) {
  const streams = []
  return {
    streams,
    async resolveModelInfo() {
      return { inputModalities: capable ? ['text', 'image'] : ['text'] }
    },
    async *stream(options) {
      streams.push(options)
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

/**
 * Session faithful to the extracted surface contract: contiguous seq log,
 * surfaceOp append/replace validation (single current node, earlier seqs,
 * tool/result content-only rewrite, sourceEventSeqs completeness), and
 * deriveMessages() folding appends + replaces with offloaded marks carried
 * in persisted content.
 */
class HarnessSession {
  constructor() {
    this.log = []
    this.surface = { nodes: [] }
  }

  eventAt(seq) {
    return this.log[seq]
  }

  append(type, data, options) {
    const seq = this.log.length
    const event = { type, seq, time: Date.now(), data, ...(options ?? {}) }
    this.#validate(event, options)
    this.log.push(event)
    if (event.type === 'tool/result' || event.type === 'user/message' || event.type === 'assistant/message' || event.type === 'system/message') {
      if (options?.surfaceOp?.op === 'replace') {
        this.surface.nodes = this.surface.nodes.filter((n) => n !== options.surfaceOp.startSeq)
      }
      this.surface.nodes.push(seq)
    }
    return event
  }

  #validate(event, options) {
    if (event.type !== 'tool/result' && event.type !== 'user/message') return
    const op = options?.surfaceOp
    if (op === undefined || op === 'append') return
    const { startSeq, endSeq } = op
    assert.ok(startSeq === endSeq, 'single-node replace only')
    assert.ok(startSeq < event.seq, 'targets earlier events')
    assert.ok(this.surface.nodes.includes(startSeq), 'target is a current surface node')
    const original = this.log[startSeq]
    assert.equal(original.type, event.type, 'replace keeps the event type')
    if (event.type === 'tool/result') {
      const rest = (e) => ({ ...e.data, message: { ...e.data.message, content: null } })
      assert.deepEqual(rest(event), rest(original), 'tool/result replace may change only content')
    }
    const refs = options.sourceEventSeqs
    assert.ok(Array.isArray(refs) && refs.includes(startSeq), 'sourceEventSeqs cites the shadowed node')
  }

  deriveMessages() {
    // 'user/message' event data IS the message; 'tool/result' wraps it in
    // {turn, step, message} (packages/core/session/src/types.ts:308/383).
    return this.surface.nodes.map((seq) => {
      const event = this.log[seq]
      return event.type === 'user/message' ? event.data : event.data.message
    })
  }

  /** Request projection per content.ts semantics: offloaded:true image blocks
   * become placeholder text; live blocks serialize as image bytes. */
  projectRequest() {
    const blocksOf = (message) => message.content.flatMap((block) => {
      if (block.type !== 'image') return [block]
      if (block.offloaded === true) return [{ type: 'text', text: `[image omitted … ${block.attachment.attachmentId}]` }]
      return [block]
    })
    return this.deriveMessages().map((message) => ({ ...message, content: blocksOf(message) }))
  }

  liveImageBlocks() {
    return this.projectRequest().flatMap((m) => m.content).filter((b) => b.type === 'image')
  }
}

function makePlugin(llm, config = {}) {
  const listeners = new Map()
  const ctx = {
    llm,
    on: (name, fn) => listeners.set(name, fn),
    tools: { register: () => () => {} },
  }
  apply(ctx, config)
  return listeners
}

/** Drive one pre-step exactly like agent.ts: waterfall → append → derive. */
async function runStep(session, listeners, { messages, modelSelection = { provider: 'sz', model: 'vl' } } = {}) {
  const listener = listeners.get('agent/pre-step')
  const claimed = messages
  const decision = await listener(
    { agent: { session }, messages: claimed, turn: 1, step: 1, signal: new AbortController().signal, modelSelection },
    async () => ({ kind: 'enter', messages: claimed }),
  )
  assert.equal(decision.kind, 'enter')
  for (const message of decision.messages) {
    session.append('user/message', message, { surfaceOp: 'append' })
  }
  return session.projectRequest()
}

test('A. paste → very first request carries zero image bytes; tag text present', async () => {
  const session = new HarnessSession()
  const listeners = makePlugin(fakeLlm())
  const request = await runStep(session, listeners, {
    messages: [{
      id: 'm1', role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: '这个报错怎么解决' }, { type: 'image', attachment: ref('sha256:a1') }],
    }],
  })
  assert.equal(session.liveImageBlocks().length, 0, 'no live image block reaches the request')
  const texts = request[0].content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  assert.match(texts, /image omitted … sha256:a1/, 'platform placeholder for the offloaded block')
  assert.match(texts, /图片已归档/, 'adjacent archive tag')
  assert.match(texts, /机器解析（sz\/vl，可能不准确/, 'provenance line')
  // Persisted (durable) message keeps the image block — thumbnails survive.
  const persisted = session.log.at(-1).data.content
  assert.equal(persisted.filter((b) => b.type === 'image').length, 1)
  assert.equal(persisted.find((b) => b.type === 'image').offloaded, true)
})

test('B. per-message cap: first image described, second archives without description', async () => {
  const session = new HarnessSession()
  const listeners = makePlugin(fakeLlm(), { maxDescribedPerMessage: { get: () => 1 } })
  await runStep(session, listeners, {
    messages: [{
      id: 'm1', role: 'user', source: { kind: 'user' },
      content: [{ type: 'image', attachment: ref('sha256:x1') }, { type: 'image', attachment: ref('sha256:x2') }],
    }],
  })
  const tagLines = session.log.at(-1).data.content.filter((b) => b.type === 'text').map((b) => b.text)
  const x1 = tagLines.find((line) => line.includes('sha256:x1'))
  const x2 = tagLines.find((line) => line.includes('sha256:x2'))
  assert.match(x1, /机器解析（sz\/vl/, 'first image described')
  assert.match(x2, /未解析（超出每条消息解析上限/, 'second image archived without description')
  assert.equal(session.liveImageBlocks().length, 0)
})

test('C. text-only route: archives without description, still zero bytes, no stream calls', async () => {
  const llm = fakeLlm({ capable: false })
  const session = new HarnessSession()
  const listeners = makePlugin(llm)
  await runStep(session, listeners, {
    messages: [{
      id: 'm1', role: 'user', source: { kind: 'user' },
      content: [{ type: 'image', attachment: ref('sha256:t1') }],
    }],
  })
  assert.equal(llm.streams.length, 0)
  assert.equal(session.liveImageBlocks().length, 0)
  assert.match(session.log.at(-1).data.content[1].text, /未解析（/)
})

test('D. mm_view_image result egress: next pre-step replaces, idempotent, request clean after', async () => {
  const session = new HarnessSession()
  // A prior step persisted an archived user image…
  session.append('user/message', {
    id: 'm1', role: 'user', source: { kind: 'user' },
    content: [{ type: 'image', attachment: ref('sha256:a1'), offloaded: true }],
  }, { surfaceOp: 'append' })
  // …and the model viewed it: a tool/result with live pixels (our render output).
  const toolResultSeq = session.append('tool/result', {
    turn: 1, step: 1,
    message: {
      id: 'r1', role: 'tool', source: { kind: 'tool', callId: 'call-1' }, toolCallId: 'call-1',
      content: [
        { type: 'text', text: '[mm_view_image sha256:a1] 归档描述（sz/vl）：一张截图' },
        { type: 'image', attachment: ref('sha256:a1') },
      ],
    },
  }, { surfaceOp: 'append' }).seq
  assert.equal(session.liveImageBlocks().length, 1, 'pixels ride before egress')

  const listeners = makePlugin(fakeLlm())
  const request = await runStep(session, listeners, {
    messages: [{ id: 'm2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] }],
  })
  assert.equal(session.liveImageBlocks().length, 0, 'egress cleared the tool-result pixels')
  const replacement = session.log.find((e) => e.surfaceOp?.op === 'replace')
  assert.equal(replacement.surfaceOp.startSeq, toolResultSeq)
  assert.deepEqual(replacement.sourceEventSeqs, [toolResultSeq])
  assert.equal(replacement.data.message.content[1].offloaded, true)
  assert.equal(replacement.data.message.content[0].text.includes('归档描述'), true, 'text kept verbatim')
  assert.match(request[2].content[0].text, /继续/)
  // Idempotent: a further step appends nothing new.
  const before = session.log.length
  await runStep(session, listeners, { messages: [{ id: 'm3', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '再继续' }] }] })
  assert.equal(session.log.filter((e) => e.surfaceOp?.op === 'replace').length, 1)
  assert.ok(session.log.length > before)
})

test('E. error-turn survival: egress fires on the next press even without turn-stopping', async () => {
  const session = new HarnessSession()
  session.append('tool/result', {
    turn: 1, step: 1,
    message: {
      id: 'r1', role: 'tool', source: { kind: 'tool', callId: 'call-9' }, toolCallId: 'call-9',
      content: [{ type: 'image', attachment: ref('sha256:e1') }],
    },
  }, { surfaceOp: 'append' })
  // Turn 1 ends in ERROR — agent/turn-stopping never fires (extracted fact).
  const listeners = makePlugin(fakeLlm())
  await runStep(session, listeners, {
    messages: [{ id: 'm2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '报错中断了，请继续' }] }],
  })
  assert.equal(session.liveImageBlocks().length, 0)
})

test('F. plugin-disabled replay: the log derives without the plugin; no custom event types were emitted', async () => {
  const session = new HarnessSession()
  const listeners = makePlugin(fakeLlm())
  await runStep(session, listeners, {
    messages: [{
      id: 'm1', role: 'user', source: { kind: 'user' },
      content: [{ type: 'image', attachment: ref('sha256:f1') }],
    }],
  })
  session.append('tool/result', {
    turn: 1, step: 1,
    message: {
      id: 'r1', role: 'tool', source: { kind: 'tool', callId: 'call-2' }, toolCallId: 'call-2',
      content: [{ type: 'image', attachment: ref('sha256:f1') }],
    },
  }, { surfaceOp: 'append' })
  egressLiveToolImages(session)

  // Every event the plugin produced is a standard vocabulary member.
  const emittedTypes = new Set(session.log.map((e) => e.type))
  assert.deepEqual([...emittedTypes].sort(), ['tool/result', 'user/message'])
  // A plugin-less reader folds the same log: messages derivable, thumbnails
  // intact, and the replace-shadowed original leaves the replacement current.
  const derived = session.deriveMessages()
  assert.equal(derived.length, 2, 'user message + replacement tool result (original shadowed)')
  assert.equal(derived[0].content.find((b) => b.type === 'image').offloaded, true)
  assert.equal(derived[1].content.find((b) => b.type === 'image').offloaded, true, 'replacement carries the persisted mark')
})
