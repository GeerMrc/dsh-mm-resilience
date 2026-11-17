/**
 * Pure content-block helpers for the hybrid archive rewrite: a pasted image
 * keeps its block identity and gains `offloaded: true` (the sanctioned
 * "preserved by a message rewrite" origin, ImageBlock docs), with an
 * adjacent text block carrying the machine description and re-view pointer.
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

/** Human-readable identity used in tags: `name (attachmentId) WxH`. */
function identityOf(ref) {
  const name = ref.name === undefined ? String(ref.attachmentId) : `${ref.name} (${ref.attachmentId})`
  return `${name} ${ref.width}x${ref.height}`
}

/**
 * Build the archive tag text block placed right after each archived image.
 *
 * @param {import('./blocks.js').ImageRef} ref - the image's attachment ref.
 * @param {{ text: string, provider: string, model: string } | null} description
 * @returns {{ type: 'text', text: string }}
 */
export function archiveTag(ref, description) {
  const identity = identityOf(ref)
  if (description === null) {
    return { type: 'text', text: `[图片已归档 ${identity}] 未解析（超出每条消息解析上限或路由不可用；可用 mm_view_image 回看原图）` }
  }
  return {
    type: 'text',
    text: `[图片已归档 ${identity}] 机器解析（${description.provider}/${description.model}，可能不准确；可用 mm_view_image 回看原图）：${description.text}`,
  }
}

/**
 * Rewrite one claimed user message: every live image block becomes
 * `{ ...block, offloaded: true }` followed by its archive tag; all other
 * blocks and the message identity (id/role/source) are preserved verbatim.
 *
 * @param {{ content?: readonly unknown[] }} message
 * @param {Map<string, { text: string, provider: string, model: string } | null>} descriptions
 * @returns {object | null} the rewritten message, or null when nothing changed.
 */
export function rewriteMessage(message, descriptions) {
  if (!Array.isArray(message?.content)) return null
  let changed = false
  const out = []
  for (const block of message.content) {
    if (isLiveImageBlock(block)) {
      changed = true
      out.push(Object.freeze({ ...block, offloaded: true }))
      out.push(archiveTag(block.attachment, descriptions.get(block.attachment.attachmentId) ?? null))
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
