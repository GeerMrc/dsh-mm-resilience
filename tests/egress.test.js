/**
 * Egress pass: at every agent/pre-step, every current-surface tool/result
 * still carrying live image blocks is rewritten in place by a logged
 * single-node `surfaceOp: 'replace'` append that marks those blocks
 * `offloaded: true` — the official compaction-tool-result-pruner pattern
 * (session.surface.nodes + same-callId replace, content-only change).
 *
 * Why pre-step and not `agent/turn-stopping`: the stopping event does not
 * fire on error-ended turns, while every model request is preceded by a
 * pre-step — so this pass covers error turns, aborted turns, and restarts
 * (it derives purely from the current surface each time, needs no in-memory
 * state, and is idempotent). Re-view pixels therefore ride exactly the
 * requests of the step that consumed them.
 *
 * @module dsh-mm-resilience/tests/egress.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { egressLiveToolImages } from '../src/egress.js'

const ref = (attachmentId) => ({ attachmentId, mediaType: 'image/png', width: 10, height: 10, bytes: 5 })

function fakeSession(events) {
  // events: Map<seq, event>; surface "nodes" mirrors current surface seqs.
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
      // A replace shadows its target: simulate the surface swap.
      const target = options.surfaceOp.startSeq
      surface.nodes = surface.nodes.map((n) => (n === target ? seq : n))
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

test('egress: live-image tool results are replaced with offloaded marks', () => {
  const session = fakeSession(new Map([
    [0, { type: 'turn/start', data: {} }],
    [1, toolResult(1, [{ type: 'text', text: '结果' }, { type: 'image', attachment: ref('a') }])],
  ]))
  const replaced = egressLiveToolImages(session)
  assert.deepEqual(replaced, [1])
  const append = session.appends[0]
  assert.equal(append.type, 'tool/result')
  assert.deepEqual(append.options, { surfaceOp: { op: 'replace', startSeq: 1, endSeq: 1 }, sourceEventSeqs: [1] })
  // content-only change: identity/source/callId preserved; image marked; text kept
  const message = append.data.message
  assert.equal(message.id, 'm1')
  assert.deepEqual(message.source, { kind: 'tool', callId: 'c1' })
  assert.equal(message.toolCallId, 'c1')
  assert.equal(message.content[0].text, '结果')
  assert.equal(message.content[1].type, 'image')
  assert.equal(message.content[1].offloaded, true)
  assert.equal(message.content[1].attachment.attachmentId, 'a')
  // surrounding event.data fields preserved verbatim
  assert.equal(append.data.turn, 1)
  assert.equal(append.data.step, 1)
})

test('egress: offloaded and text-only results are untouched; non tool/result ignored', () => {
  const session = fakeSession(new Map([
    [1, toolResult(1, [{ type: 'image', attachment: ref('a'), offloaded: true }])],
    [2, toolResult(2, [{ type: 'text', text: '纯文本' }])],
    [3, { type: 'user/message', data: { role: 'user', content: [{ type: 'image', attachment: ref('b') }], id: 'u1', source: { kind: 'user' } } }],
  ]))
  assert.deepEqual(egressLiveToolImages(session), [])
  assert.equal(session.appends.length, 0)
})

test('egress: idempotent — a replaced result is not replaced again', () => {
  const session = fakeSession(new Map([
    [1, toolResult(1, [{ type: 'image', attachment: ref('a') }])],
  ]))
  assert.deepEqual(egressLiveToolImages(session), [1])
  // surface now points at the replacement (content already offloaded)
  assert.deepEqual(egressLiveToolImages(session), [])
  assert.equal(session.appends.length, 1)
})

test('egress: multiple live results each get their own replace', () => {
  const session = fakeSession(new Map([
    [1, toolResult(1, [{ type: 'image', attachment: ref('a') }])],
    [2, toolResult(2, [{ type: 'text', text: 't' }, { type: 'image', attachment: ref('b') }, { type: 'image', attachment: ref('c') }])],
  ]))
  const replaced = egressLiveToolImages(session)
  assert.deepEqual(replaced.sort(), [1, 2])
  const second = session.appends.find((a) => a.options.surfaceOp.startSeq === 2)
  assert.equal(second.data.message.content.filter((b) => b.type === 'image' && b.offloaded === true).length, 2)
})

test('egress: missing surface or eventAt degrades to a no-op', () => {
  assert.deepEqual(egressLiveToolImages({}), [])
  assert.deepEqual(egressLiveToolImages(null), [])
  assert.deepEqual(egressLiveToolImages({ surface: { nodes: [1] } }), [])
})
