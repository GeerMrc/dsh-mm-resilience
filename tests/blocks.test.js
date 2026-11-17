/**
 * Archive-rewrite pure helpers.
 *
 * @module dsh-mm-resilience/tests/blocks.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { archiveTag, collectLiveImageRefs, isLiveImageBlock, rewriteMessage } from '../src/blocks.js'

const ref = (attachmentId, extra = {}) => ({ attachmentId, mediaType: 'image/png', width: 100, height: 50, bytes: 10, ...extra })

test('isLiveImageBlock: only non-offloaded image blocks', () => {
  assert.equal(isLiveImageBlock({ type: 'image', attachment: ref('a') }), true)
  assert.equal(isLiveImageBlock({ type: 'image', attachment: ref('a'), offloaded: true }), false)
  assert.equal(isLiveImageBlock({ type: 'text', text: 'x' }), false)
  assert.equal(isLiveImageBlock(null), false)
})

test('archiveTag: description carries provider/model provenance and re-view pointer', () => {
  const tag = archiveTag(ref('a', { name: 'shot.png' }), { text: '一个按钮', provider: 'sz', model: 'vl' })
  assert.equal(tag.type, 'text')
  assert.match(tag.text, /^\[图片已归档 shot\.png \(a\) 100x50\]/)
  assert.match(tag.text, /机器解析（sz\/vl，可能不准确；可用 mm_view_image 回看原图）：一个按钮$/)
})

test('archiveTag: null description renders the honest unparsed form', () => {
  const tag = archiveTag(ref('b'), null)
  assert.match(tag.text, /^\[图片已归档 b 100x50\] 未解析（超出每条消息解析上限或路由不可用；可用 mm_view_image 回看原图）$/)
})

test('rewriteMessage: image → offloaded copy + adjacent tag; identity and order preserved', () => {
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
  const rewritten = rewriteMessage(message, new Map([['a', { text: '描述A', provider: 'p', model: 'm' }]]))
  assert.notEqual(rewritten, null)
  assert.equal(rewritten.id, 'm1')
  assert.equal(rewritten.role, 'user')
  assert.deepEqual(rewritten.source, { kind: 'user' })
  assert.equal(rewritten.content.length, 4)
  assert.equal(rewritten.content[0].text, '看图')
  assert.equal(rewritten.content[1].offloaded, true)
  assert.equal(rewritten.content[1].attachment.attachmentId, 'a')
  assert.equal(rewritten.content[2].type, 'text')
  assert.match(rewritten.content[2].text, /描述A/)
  assert.equal(rewritten.content[3].text, '第二段')
  // original untouched (copy-on-write)
  assert.equal(message.content[1].offloaded, undefined)
  assert.equal(message.content.length, 3)
})

test('rewriteMessage: no live images → null; already-offloaded skipped', () => {
  assert.equal(rewriteMessage({ id: 'm', content: [{ type: 'text', text: 'x' }] }, new Map()), null)
  const kept = rewriteMessage({ id: 'm', content: [{ type: 'image', attachment: ref('a'), offloaded: true }] }, new Map())
  assert.equal(kept, null)
})

test('collectLiveImageRefs: unique in order, skips runtime-context and non-image', () => {
  const refs = collectLiveImageRefs([
    { source: { kind: 'user' }, content: [{ type: 'image', attachment: ref('a') }, { type: 'image', attachment: ref('a') }] },
    { source: { kind: 'runtime-context' }, content: [{ type: 'image', attachment: ref('skip') }] },
    { source: { kind: 'user' }, content: [{ type: 'image', attachment: ref('b', { offloaded: undefined }) }, { type: 'text', text: 'x' }] },
    { source: { kind: 'user' }, content: [{ type: 'image', attachment: ref('c'), offloaded: true }] },
  ])
  assert.deepEqual(refs.map((r) => r.attachmentId), ['a', 'b'])
})
