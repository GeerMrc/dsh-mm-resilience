/**
 * Egress pass with the rode-once fence.
 *
 * @module dsh-mm-resilience/tests/egress.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createEgressState, egressLiveToolImages } from '../src/egress.js'

const ref = (attachmentId) => ({ attachmentId, mediaType: 'image/png', width: 10, height: 10, bytes: 5 })

function fakeSession(events) {
  const appends = []
  let nextSeq = Math.max(-1, ...events.keys()) + 1
  const surface = { nodes: [...events.keys()] }
  return {
    appends,
    surface,
    eventAt: (seq) => events.get(seq),
    append(type, data, options) {
      const seq = nextSeq
      nextSeq += 1
      if (options?.surfaceOp?.op === 'replace') {
        surface.nodes = surface.nodes.filter((n) => n !== options.surfaceOp.startSeq)
      }
      surface.nodes.push(seq)
      events.set(seq, { type, data })
      appends.push({ type, data, options, seq })
      return { seq }
    },
  }
}

const toolResult = (seq, content, extra = {}) => ({
  seq,
  type: 'tool/result',
  data: { turn: 1, step: 1, message: { id: `m${seq}`, role: 'tool', content, source: { kind: 'tool', callId: `c${seq}` }, toolCallId: `c${seq}` }, ...extra },
})

test('rode-once fence: a fresh result rides the upcoming request, cleared only after it', () => {
  const session = fakeSession(new Map([
    [1, toolResult(1, [{ type: 'text', text: '结果' }, { type: 'image', attachment: ref('a') }])],
  ]))
  const state = createEgressState()

  // Pass 1 (pre-step right after the tool ran): kept so the derived request
  // can carry the pixels exactly once.
  assert.deepEqual(egressLiveToolImages(session, state), [])
  assert.equal(session.appends.length, 0)
  assert.deepEqual([...state.seen], [1])

  // Caller marks that an `enter` decision followed → a request derived.
  state.requestedSinceSeen = true

  // Pass 2 (next pre-step): replaced.
  assert.deepEqual(egressLiveToolImages(session, state), [1])
  const append = session.appends[0]
  assert.equal(append.type, 'tool/result')
  assert.deepEqual(append.options, { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, sourceEventSeqs: [1] })
  const message = append.data.message
  assert.equal(message.id, 'm1')
  assert.deepEqual(message.source, { kind: 'tool', callId: 'c1' })
  assert.equal(message.toolCallId, 'c1')
  assert.equal(message.content[0].text, '结果')
  assert.equal(message.content[1].type, 'image')
  assert.equal(message.content[1].offloaded, true)
  assert.equal(message.content[1].attachment.attachmentId, 'a')
  assert.equal(append.data.turn, 1)
  assert.equal(append.data.step, 1)

  // Pass 3: idempotent.
  state.requestedSinceSeen = true
  assert.deepEqual(egressLiveToolImages(session, state), [])
  assert.equal(session.appends.length, 1)
})

test('fence: seen-but-never-requested results are NOT cleared (reject path)', () => {
  const session = fakeSession(new Map([
    [1, toolResult(1, [{ type: 'image', attachment: ref('a') }])],
  ]))
  const state = createEgressState()
  egressLiveToolImages(session, state) // seen
  // decision was reject → no request derived since seen
  state.requestedSinceSeen = false
  assert.deepEqual(egressLiveToolImages(session, state), [])
  assert.equal(session.appends.length, 0)
})

test('offloaded and text-only results are untouched; non tool/result ignored', () => {
  const session = fakeSession(new Map([
    [1, toolResult(1, [{ type: 'image', attachment: ref('a'), offloaded: true }])],
    [2, toolResult(2, [{ type: 'text', text: '纯文本' }])],
    [3, { type: 'user/message', data: { role: 'user', content: [{ type: 'image', attachment: ref('b') }], id: 'u1', source: { kind: 'user' } } }],
  ]))
  const state = createEgressState()
  state.requestedSinceSeen = true
  assert.deepEqual(egressLiveToolImages(session, state), [])
  assert.deepEqual([...state.seen], [])
})

test('multiple live results each get their own replace; content-only change', () => {
  const session = fakeSession(new Map([
    [1, toolResult(1, [{ type: 'image', attachment: ref('a') }])],
    [2, toolResult(2, [{ type: 'text', text: 't' }, { type: 'image', attachment: ref('b') }, { type: 'image', attachment: ref('c') }], { meta: { x: 1 } })],
  ]))
  const state = createEgressState()
  egressLiveToolImages(session, state)
  state.requestedSinceSeen = true
  const replaced = egressLiveToolImages(session, state)
  assert.deepEqual(replaced.sort(), [1, 2])
  const second = session.appends.find((a) => a.options.surfaceOp.startSeq === 2)
  assert.equal(second.data.message.content.filter((b) => b.type === 'image' && b.offloaded === true).length, 2)
  assert.deepEqual(second.data.meta, { x: 1 }, 'non-content event data preserved verbatim')
})

test('missing surface or eventAt degrades to a no-op and resets the fence', () => {
  const state = createEgressState()
  state.seen = new Set([1])
  state.requestedSinceSeen = true
  assert.deepEqual(egressLiveToolImages({}, state), [])
  assert.deepEqual(egressLiveToolImages(null, state), [])
  assert.deepEqual(egressLiveToolImages({ surface: { nodes: [1] } }, state), [])
  assert.deepEqual([...state.seen], [])
})
