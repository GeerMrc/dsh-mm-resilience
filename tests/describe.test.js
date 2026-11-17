/**
 * Auxiliary single-image describe channel: bounded worker pool, per-call
 * timeout, total-budget tail skip, attachmentId-keyed LRU with in-flight
 * dedupe, and a never-throw contract — a failed or skipped describe yields
 * no map entry and the rewrite archives the image without a description.
 *
 * The describe call is a one-shot `ctx.llm.stream` in the compaction-summarizer
 * shape (no `purpose` — the closed union is reserved for official callers);
 * its envelope attribution (provider/model) rides inline in the archive tag,
 * and its input is deterministic code over logged referenced objects.
 *
 * @module dsh-mm-resilience/tests/describe.test
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createDescriber } from '../src/describe.js'

const refFor = (attachmentId) => ({ attachmentId, mediaType: 'image/png', width: 10, height: 10, bytes: 5 })

const ref = (attachmentId) => ({ attachmentId, mediaType: 'image/png', width: 10, height: 10, bytes: 5 })
const baseConfig = {
  maxDescribedPerMessage: 8,
  describeConcurrency: 2,
  describeTimeoutMs: 10_000,
  describeTotalBudgetMs: 15_000,
}

function fakeLlm({ capable = true, textFor = () => 'ok', streams = undefined, onStream } = {}) {
  const calls = []
  const llm = {
    calls,
    async resolveModelInfo() {
      return { inputModalities: capable ? ['text', 'image'] : ['text'] }
    },
    async *stream(options) {
      calls.push(options)
      onStream?.(options)
      const behavior = streams?.shift() ?? { kind: 'ok', text: textFor(options) }
      if (behavior.kind === 'hang') {
        // Real streams abort with the call signal; model that (no silent hang).
        await new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
          }, { once: true })
        })
        return
      }
      if (behavior.kind === 'throw') throw new Error(behavior.error)
      yield { type: 'text-delta', index: 0, text: behavior.text }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
  return llm
}

const route = { provider: 'sz', model: 'vl' }

test('describes images and returns provider/model provenance', async () => {
  const llm = fakeLlm({ textFor: () => '图里有按钮' })
  const describer = createDescriber({ llm, configRef: () => baseConfig })
  const map = await describer.describeImages([ref('a'), ref('b')], route)
  assert.equal(map.get('a').text, '图里有按钮')
  assert.equal(map.get('a').provider, 'sz')
  assert.equal(map.get('a').model, 'vl')
  assert.equal(map.size, 2)
  // one-shot request shape: single user message, image + prompt, bounded maxTokens
  const options = llm.calls[0]
  assert.equal(options.provider, 'sz')
  assert.equal(options.maxTokens, 400)
  assert.equal(options.messages.length, 1)
  assert.equal(options.messages[0].role, 'user')
  assert.equal(options.messages[0].content[0].type, 'image')
  assert.equal(options.messages[0].content[1].type, 'text')
})

test('capability gate: text-only route yields no entries and no stream calls', async () => {
  const llm = fakeLlm({ capable: false })
  const describer = createDescriber({ llm, configRef: () => baseConfig })
  const map = await describer.describeImages([ref('a')], route)
  assert.equal(map.size, 0)
  assert.equal(llm.calls.length, 0)
})

test('missing route yields no entries without touching the llm', async () => {
  const llm = fakeLlm()
  const describer = createDescriber({ llm, configRef: () => baseConfig })
  assert.equal((await describer.describeImages([ref('a')], null)).size, 0)
  assert.equal(llm.calls.length, 0)
})

test('LRU cache: same attachmentId described once across batches', async () => {
  const llm = fakeLlm()
  const describer = createDescriber({ llm, configRef: () => baseConfig })
  await describer.describeImages([ref('a')], route)
  const second = await describer.describeImages([ref('a')], route)
  assert.equal(second.get('a').text, 'ok')
  assert.equal(llm.calls.length, 1)
})

test('per-message cap: only the first N images get described', async () => {
  const llm = fakeLlm()
  const describer = createDescriber({ llm, configRef: () => ({ ...baseConfig, maxDescribedPerMessage: 2 }) })
  const map = await describer.describeImages([ref('a'), ref('b'), ref('c')], route)
  assert.deepEqual([...map.keys()].sort(), ['a', 'b'])
  assert.equal(llm.calls.length, 2)
})

test('worker pool never exceeds describeConcurrency', async () => {
  let live = 0
  let peak = 0
  const llm = fakeLlm()
  llm.stream = async function* () {
    live += 1
    peak = Math.max(peak, live)
    await new Promise((resolve) => setTimeout(resolve, 20))
    live -= 1
    yield { type: 'text-delta', index: 0, text: 'x' }
  }
  const describer = createDescriber({ llm, configRef: () => ({ ...baseConfig, describeConcurrency: 2 }) })
  await describer.describeImages([ref('a'), ref('b'), ref('c'), ref('d')], route)
  assert.ok(peak <= 2, `peak concurrency ${peak} > 2`)
})

test('total budget is a HARD bound: in-flight calls abort at the deadline, tail is skipped', async () => {
  const llm = fakeLlm({ streams: [{ kind: 'hang' }, { kind: 'hang' }, { kind: 'hang' }] })
  const describer = createDescriber({
    llm,
    configRef: () => ({ ...baseConfig, describeConcurrency: 1, describeTotalBudgetMs: 40, describeTimeoutMs: 10_000 }),
  })
  const started = Date.now()
  const map = await describer.describeImages([ref('a'), ref('b'), ref('c')], route)
  const elapsed = Date.now() - started
  assert.equal(map.size, 0, 'the hanging call was aborted BY the deadline, not by its 10s timeout')
  assert.equal(llm.calls.length, 1, 'tail images are skipped after the deadline')
  assert.ok(elapsed < 500, `hard bound honored (${elapsed}ms, budget 40ms)`)
})

test('stream error yields no entry and never throws', async () => {
  const llm = fakeLlm({ streams: [{ kind: 'throw', error: 'gateway down' }] })
  const describer = createDescriber({ llm, configRef: () => baseConfig })
  const map = await describer.describeImages([ref('a')], route)
  assert.equal(map.size, 0)
})

test('per-call timeout aborts a hanging stream into a skipped entry', async () => {
  const llm = fakeLlm({ streams: [{ kind: 'hang' }, { kind: 'hang' }] })
  const describer = createDescriber({ llm, configRef: () => ({ ...baseConfig, describeTimeoutMs: 30 }) })
  const map = await describer.describeImages([ref('a'), ref('b')], route)
  assert.equal(map.size, 0) // both hanging streams aborted at the per-call timeout
  assert.equal(llm.calls.length, 2)
})

test('abort signal cancels pending describes without throwing', async () => {
  const llm = fakeLlm({ streams: [{ kind: 'hang' }] })
  const describer = createDescriber({ llm, configRef: () => baseConfig })
  const controller = new AbortController()
  const pending = describer.describeImages([ref('a')], route, controller.signal)
  controller.abort()
  const map = await pending
  assert.equal(map.size, 0)
})
