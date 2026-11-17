/**
 * Egress pass: rewrite every current-surface tool/result that still carries
 * live image blocks, appending a logged single-node `surfaceOp: 'replace'`
 * tool/result (same event data except content) whose image blocks are marked
 * `offloaded: true` — the official compaction-tool-result-pruner mechanism
 * (`session.surface.nodes` + `session.eventAt(seq)` + content-only replace,
 * `sourceEventSeqs: [seq]`).
 *
 * Runs at every `agent/pre-step` (not `agent/turn-stopping`, which does not
 * fire on error-ended turns): every model request is preceded by a pre-step,
 * so re-view pixels ride exactly the requests of the step that consumed the
 * tool result. Pure derivation from the current surface — idempotent,
 * restart-safe, no in-memory state.
 *
 * @module dsh-mm-resilience/egress
 */

import { isLiveImageBlock } from './blocks.js'

/**
 * Replace every current tool/result carrying live image blocks with an
 * offloaded-marked copy. Never throws for missing host APIs; a rejected
 * append propagates to the caller (the entry wraps it in a warn).
 *
 * @param {object | null | undefined} session - the agent's Session.
 * @returns {number[]} seqs of the tool/result nodes replaced this pass.
 */
export function egressLiveToolImages(session) {
  const nodes = session?.surface?.nodes
  if (nodes === undefined || typeof nodes[Symbol.iterator] !== 'function') return []
  const eventAt = typeof session.eventAt === 'function' ? session.eventAt.bind(session) : undefined
  if (eventAt === undefined) return []

  const replaced = []
  for (const seq of [...nodes]) {
    const event = eventAt(seq)
    if (event?.type !== 'tool/result') continue
    const message = event.data?.message
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) continue

    let live = false
    const content = message.content.map((block) => {
      if (isLiveImageBlock(block)) {
        live = true
        return Object.freeze({ ...block, offloaded: true })
      }
      return block
    })
    if (!live) continue

    session.append('tool/result', {
      ...event.data,
      message: Object.freeze({ ...message, content: Object.freeze(content) }),
    }, {
      surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
      sourceEventSeqs: [seq],
    })
    replaced.push(seq)
  }
  return replaced
}
