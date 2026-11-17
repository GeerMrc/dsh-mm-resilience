/**
 * Egress pass with a rode-once fence: rewrite every current-surface
 * tool/result that still carries live image blocks AND has already been
 * visible to at least one derived request, appending a logged single-node
 * `surfaceOp: 'replace'` tool/result (same event data except content) whose
 * image blocks are marked `offloaded: true` — the official
 * compaction-tool-result-pruner mechanism (`session.surface.nodes` +
 * `session.eventAt(seq)` + content-only replace, `sourceEventSeqs: [seq]`).
 *
 * Why the fence: pre-step N+1 runs BEFORE the request that would carry a
 * tool/result appended during step N (agent.ts: preStep → append →
 * buildRequest). Clearing unconditionally would mean re-view pixels never
 * reach any request. The per-session {@link EgressState} tracks which live
 * results a previous pre-step already saw and whether a request was derived
 * since (an `enter` decision); only those are cleared. After a restart the
 * state is empty, so a stale result rides at most one more request — safe.
 *
 * Runs at every `agent/pre-step` (not `agent/turn-stopping`, which does not
 * fire on error-ended turns): every model request is preceded by a pre-step,
 * so error turns, aborts, and restarts all stay covered (a restart empties
 * the fence state, costing at most one extra pixel-bearing request).
 *
 * @module dsh-mm-resilience/egress
 */

import { isLiveImageBlock } from './blocks.js'

/**
 * Per-session fence state.
 *
 * @typedef {object} EgressState
 * @property {Set<number>} seen - live result seqs observed at the previous pre-step.
 * @property {boolean} requestedSinceSeen - whether an `enter` decision (and thus a
 *   request derivation over the seen surface) followed the previous pre-step.
 */

/** Create a fresh fence state for one session. */
export function createEgressState() {
  return { seen: new Set(), requestedSinceSeen: false }
}

let warnedNoSurfaceApi = false

/**
 * One egress pass. Clearing is fenced on "seen at a previous pre-step AND a
 * request derived since" (`requestedSinceSeen`, which the CALLER sets to
 * `decision.kind === 'enter'` after its `next()`); freshly appended results
 * stay live so the upcoming request can carry them exactly once. Degrades to
 * a no-op when the host lacks `surface.nodes`/`eventAt` (warned once — a
 * silent dead safety net is the failure class this plugin exists to kill).
 *
 * @param {object | null | undefined} session - the agent's Session.
 * @param {EgressState} state - the session's fence state; `seen` is updated
 *   by this pass, `requestedSinceSeen` is owned by the caller.
 * @returns {number[]} seqs of the tool/result nodes replaced this pass.
 */
export function egressLiveToolImages(session, state) {
  const nodes = session?.surface?.nodes
  const hasApi = Array.isArray(nodes) || (nodes !== undefined && typeof nodes[Symbol.iterator] === 'function')
  if (!hasApi || typeof session.eventAt !== 'function') {
    maybeWarnNoSurfaceApi()
    state.seen = new Set()
    return []
  }
  const eventAt = session.eventAt.bind(session)

  const nextSeen = new Set()
  const replaced = []
  for (const seq of [...nodes]) {
    const event = eventAt(seq)
    if (event?.type !== 'tool/result') continue
    const message = event.data?.message
    if (message === null || typeof message !== 'object' || !Array.isArray(message.content)) continue
    if (!message.content.some(isLiveImageBlock)) continue

    if (state.seen.has(seq) && state.requestedSinceSeen) {
      const content = message.content.map((block) => (isLiveImageBlock(block)
        ? Object.freeze({ ...block, offloaded: true })
        : block))
      session.append('tool/result', {
        ...event.data,
        message: Object.freeze({ ...message, content: Object.freeze(content) }),
      }, {
        surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
        sourceEventSeqs: [seq],
      })
      replaced.push(seq)
    } else {
      // Not yet visible to any derived request: let the upcoming request
      // carry the pixels exactly once.
      nextSeen.add(seq)
    }
  }
  state.seen = nextSeen
  return replaced
}

function maybeWarnNoSurfaceApi() {
  if (warnedNoSurfaceApi) return
  warnedNoSurfaceApi = true
  console.warn('[mm-resilience] egress unavailable on this host (surface.nodes/eventAt absent); pixel-bearing tool results will keep riding requests')
}
