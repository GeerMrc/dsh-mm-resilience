/**
 * Archive-rewrite pure helpers: offload-marking keeps the user message
 * byte-identical to native DSH; descriptions ride a separate context
 * message (official collapsed-injection presentation).
 *
 * @module dsh-mm-resilience/tests/blocks.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { archiveContextMessage, collectLiveImageRefs, isLiveImageBlock, rewriteMessage } from '../src/blocks.js'

const ref = (attachmentId, extra = {}) => ({ attachmentId, mediaType: 'image/png', width: 100, height: 50, bytes: 10, ...extra })

test('isLiveImageBlock: only non-offloaded image blocks', () => {
  assert.equal(isLiveImageBlock({ type: 'image', attachment: ref('a') }), true)
  assert.equal(isLiveImageBlock({ type: 'image', attachment: ref('a'), offloaded: true }), false)
  assert.equal(isLiveImageBlock({ type: 'text', text: 'x' }), false)
  assert.equal(isLiveImageBlock(null), false)
})

test('rewriteMessage: marks images offloaded ONLY — no text added, identity and order preserved', () => {
  const message = {
    id: 'm1',
    role: 'user',
    source: { kind: 'user' },
    content: [
      { type: 'text', text: '看图' },
      { type: 'image', attachment: ref('a') },
      { type: 'text', text: '第二段' },
    ],
  }
  const rewritten = rewriteMessage(message)
  assert.notEqual(rewritten, null)
  assert.equal(rewritten.id, 'm1')
  assert.equal(rewritten.content.length, 3, 'no tag block inserted — native bubble shape')
  assert.deepEqual(rewritten.content.map((b) => b.type), ['text', 'image', 'text'])
  assert.equal(rewritten.content[1].offloaded, true)
  assert.equal(rewritten.content[0].text, '看图')
  assert.equal(rewritten.content[2].text, '第二段')
  assert.equal(message.content[1].offloaded, undefined, 'copy-on-write: original untouched')
  assert.equal(rewriteMessage({ id: 'm', content: [{ type: 'text', text: 'x' }] }), null)
  assert.equal(rewriteMessage({ id: 'm', content: [{ type: 'image', attachment: ref('a'), offloaded: true }] }), null)
})

test('collectLiveImageRefs: unique in order, skips runtime-context and non-image', () => {
  const refs = collectLiveImageRefs([
    { source: { kind: 'user' }, content: [{ type: 'image', attachment: ref('a') }, { type: 'image', attachment: ref('a') }] },
    { source: { kind: 'runtime-context' }, content: [{ type: 'image', attachment: ref('skip') }] },
    { source: { kind: 'user' }, content: [{ type: 'image', attachment: ref('b') }, { type: 'text', text: 'x' }] },
    { source: { kind: 'user' }, content: [{ type: 'image', attachment: ref('c'), offloaded: true }] },
  ])
  assert.deepEqual(refs.map((r) => r.attachmentId), ['a', 'b'])
})

test('archiveContextMessage: one frozen context message; only described images; null when none', () => {
  const descriptions = new Map([
    ['a', { text: '描述A', provider: 'sz', model: 'vl' }],
  ])
  const message = archiveContextMessage(descriptions, [ref('a', { name: 'shot.png' }), ref('b')])
  assert.equal(message.role, 'user')
  assert.equal(message.source.kind, 'mm-image-archive')
  assert.equal(message.source.form, 'notice')
  assert.equal(typeof message.id, 'string')
  assert.equal(message.content.length, 1)
  const text = message.content[0].text
  assert.match(text, /^\[图片 shot\.png \(a\) 100x50\] 机器解析（sz\/vl，可能不准确；可用 mm_view_image 回看原图）：描述A$/)
  assert.equal(archiveContextMessage(descriptions, [ref('b')]), null, 'undescribed image adds no line')
  assert.equal(archiveContextMessage(new Map(), [ref('a')]), null, 'no descriptions → no message at all')
})
