/**
 * Pure content-block helpers for the hybrid archive rewrite: a pasted image
 * keeps its block identity and gains `offloaded: true` (the sanctioned
 * "preserved by a message rewrite" origin, ImageBlock docs) — the user's
 * message stays byte-identical to the original apart from that mark, so the
 * transcript bubble renders exactly like native DSH. Descriptions live in a
 * SEPARATE durable message whose source kind classifies it as a context
 * injection row (the official collapsed presentation for backend-injected
 * content), keeping the model-visible archive off the user's bubble.
 *
 * @module dsh-mm-resilience/blocks
 */

/**
 * Whether a block is an image whose bytes would still be serialized into a
 * model request (`offloaded: true` blocks project to placeholder text).
 *
 * @param {unknown} block
 * @returns {boolean}
 */
export function isLiveImageBlock(block) {
  return block !== null && typeof block === 'object' && block.type === 'image' && block.offloaded !== true
}

/**
 * Rewrite one claimed user message: every live image block becomes
 * `{ ...block, offloaded: true }`; all other blocks and the message identity
 * (id/role/source) are preserved verbatim. No text is added — the transcript
 * stays identical to native DSH.
 *
 * @param {{ content?: readonly unknown[] }} message
 * @returns {object | null} the rewritten message, or null when nothing changed.
 */
export function rewriteMessage(message) {
  if (!Array.isArray(message?.content)) return null
  let changed = false
  const out = []
  for (const block of message.content) {
    if (isLiveImageBlock(block)) {
      changed = true
      out.push(Object.freeze({ ...block, offloaded: true }))
    } else {
      out.push(block)
    }
  }
  if (!changed) return null
  return Object.freeze({ ...message, content: Object.freeze(out) })
}

/**
 * Collect unique live-image attachment refs from claimed messages, in first
 * appearance order, skipping runtime-context messages (the loop re-projects
 * those, so rewrites to them are discarded).
 *
 * @param {readonly { content?: readonly unknown[], source?: { kind?: string } }[]} messages
 * @returns {object[]} unique live image refs.
 */
export function collectLiveImageRefs(messages) {
  const seen = new Set()
  const refs = []
  for (const message of messages) {
    if (message?.source?.kind === 'runtime-context' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (!isLiveImageBlock(block)) continue
      const id = block.attachment.attachmentId
      if (seen.has(id)) continue
      seen.add(id)
      refs.push(block.attachment)
    }
  }
  return refs
}

/**
 * Build the archive context message carrying the successful descriptions:
 * a durable user/message whose source kind (`mm-image-archive`, form
 * `notice`) classifies it as a context-injection row — the official
 * collapsed presentation — so the descriptions stay model-visible every
 * request without touching the user's bubble. Returns null when nothing was
 * described (failed/text-only describes add NO row at all).
 *
 * @param {Map<string, { text: string, provider: string, model: string }>} descriptions
 * @param {object[]} refs - unique live image attachment refs for this batch.
 * @returns {object | null} the frozen context message, or null.
 */
export function archiveContextMessage(descriptions, refs) {
  const lines = []
  for (const ref of refs) {
    const entry = descriptions.get(ref.attachmentId)
    if (entry === undefined) continue
    const identity = ref.name === undefined ? String(ref.attachmentId) : `${ref.name} (${ref.attachmentId})`
    lines.push(`[图片 ${identity} ${ref.width}x${ref.height}] 机器解析（${entry.provider}/${entry.model}，可能不准确；可用 mm_view_image 回看原图）：${entry.text}`)
  }
  if (lines.length === 0) return null
  return Object.freeze({
    id: globalThis.crypto.randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: lines.join('\n') })]),
    source: Object.freeze({ kind: 'mm-image-archive', form: 'notice' }),
  })
}
