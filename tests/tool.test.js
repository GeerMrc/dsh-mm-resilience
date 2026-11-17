/**
 * The `mm_view_image` re-view tool.
 *
 * @module dsh-mm-resilience/tests/tool.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createViewImageTool } from '../src/tool.js'

const ref = (attachmentId) => ({ attachmentId, mediaType: 'image/png', width: 10, height: 20, bytes: 5, name: 'shot.png' })

function fakeDescriber(entries = new Map()) {
  return {
    async describeImages(refs) {
      const out = new Map()
      for (const r of refs) if (entries.has(r.attachmentId)) out.set(r.attachmentId, entries.get(r.attachmentId))
      return out
    },
  }
}

function fakeLlm({ capable = true } = {}) {
  return {
    resolveModelInfoCalls: [],
    async resolveModelInfo(provider, model) {
      this.resolveModelInfoCalls.push(`${provider}/${model}`)
      return { inputModalities: capable ? ['text', 'image'] : ['text'] }
    },
  }
}

function fakeExec({ messages = [], header, options } = {}) {
  return {
    callId: 'call-1',
    signal: new AbortController().signal,
    agent: {
      options: options ?? {},
      session: {
        requestHeader: () => header,
        deriveMessages: () => messages,
      },
    },
  }
}

const tool = (overrides = {}) => createViewImageTool({
  llm: fakeLlm(),
  describer: fakeDescriber(new Map([['a', { text: '红色按钮', provider: 'sz', model: 'vl' }]])),
  configRef: () => ({ enabled: true }),
  ...overrides,
})

test('definition: name, read_image disambiguation, output contract, concurrency-safe', () => {
  const definition = tool()
  assert.equal(definition.name, 'mm_view_image')
  assert.match(definition.description, /read_image/)
  assert.match(definition.description, /attachmentId/)
  assert.equal(typeof definition.output.schema, 'object')
  assert.equal(typeof definition.output.render, 'function')
  assert.equal(typeof definition.execute, 'function')
  assert.equal(definition.isConcurrencySafe(), true)
  assert.equal(typeof definition.timeoutMs, 'number')
  assert.deepEqual(Object.keys(definition.parameters.properties), ['attachmentId'])
})

test('when: exposes the tool only on image-capable routes', async () => {
  const capable = tool()
  assert.equal(await capable.whenHandler({ modelSelection: { provider: 'sz', model: 'vl' }, signal: new AbortController().signal }), true)
  const textOnly = tool({ llm: fakeLlm({ capable: false }) })
  assert.equal(await textOnly.whenHandler({ modelSelection: { provider: 'sz', model: 't' }, signal: new AbortController().signal }), false)
})

test('execute: refuses without a resolvable route', async () => {
  const definition = tool()
  await assert.rejects(
    () => definition.execute({ attachmentId: 'a' }, fakeExec({})),
    /route could not be resolved/,
  )
})

test('execute: refuses on text-only routes (execute-time strict gate)', async () => {
  const definition = tool({ llm: fakeLlm({ capable: false }) })
  const exec = fakeExec({ header: { config: { provider: 'sz', model: 'txt' } } })
  await assert.rejects(
    () => definition.execute({ attachmentId: 'a' }, exec),
    /does not declare image input/,
  )
})

test('execute: unknown attachmentId is a structured refusal', async () => {
  const definition = tool()
  const exec = fakeExec({ header: { config: { provider: 'sz', model: 'vl' } }, messages: [] })
  await assert.rejects(
    () => definition.execute({ attachmentId: 'nope' }, exec),
    /no archived image with attachmentId "nope"/,
  )
})

test('execute: resolves the ref from the surface (offloaded blocks included) and returns the described value', async () => {
  const definition = tool()
  const exec = fakeExec({
    header: { config: { provider: 'sz', model: 'vl' } },
    messages: [
      { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '看' }, { type: 'image', attachment: ref('a'), offloaded: true }] },
    ],
  })
  const value = await definition.execute({ attachmentId: 'a' }, exec)
  assert.equal(value.attachmentId, 'a')
  assert.equal(value.description, '红色按钮')
  assert.equal(value.provider, 'sz')
  assert.equal(value.model, 'vl')
  assert.equal(value.width, 10)
  assert.equal(value.mediaType, 'image/png')
})

test('execute: failed describe still returns the image with an honest empty description', async () => {
  const definition = tool({ describer: fakeDescriber() })
  const exec = fakeExec({ header: { config: { provider: 'sz', model: 'vl' } }, messages: [
    { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment: ref('b') }] },
  ] })
  const value = await definition.execute({ attachmentId: 'b' }, exec)
  assert.equal(value.description, '')
  assert.equal(value.attachmentId, 'b')
})

test('render: one settled result — description text block then the image block', () => {
  const definition = tool()
  const value = { attachmentId: 'a', description: '红色按钮', provider: 'sz', model: 'vl', mediaType: 'image/png', width: 10, height: 20, bytes: 5, name: 'shot.png' }
  const blocks = definition.output.render({ attachmentId: 'a' }, value)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].type, 'text')
  assert.match(blocks[0].text, /红色按钮/)
  assert.match(blocks[0].text, /mm_view_image/)
  assert.equal(blocks[1].type, 'image')
  assert.equal(blocks[1].attachment.attachmentId, 'a')
  assert.equal(blocks[1].offloaded, undefined)
})

test('render: empty description renders the honest unavailable line', () => {
  const definition = tool()
  const blocks = definition.output.render({ attachmentId: 'a' }, { attachmentId: 'a', description: '', provider: '', model: '', mediaType: 'image/png', width: 1, height: 1, bytes: 1 })
  assert.match(blocks[0].text, /描述不可用/)
})

test('execute: refuses when the plugin is disabled via live settings', async () => {
  const definition = tool({ configRef: () => ({ enabled: false }) })
  const exec = fakeExec({ header: { config: { provider: 'sz', model: 'vl' } }, messages: [
    { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'image', attachment: ref('a') }] },
  ] })
  await assert.rejects(
    () => definition.execute({ attachmentId: 'a' }, exec),
    /plugin is disabled/,
  )
})
