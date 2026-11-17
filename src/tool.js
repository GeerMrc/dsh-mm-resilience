/**
 * The `mm_view_image` re-view tool: the only sanctioned channel through
 * which archived image pixels re-enter a request. Registered conditionally
 * (`when` on an image-capable route), gated again at execute time
 * (read_image's strict route check), resolving the attachment ref from the
 * current surface (archived blocks keep their ref), describing on demand
 * through the shared bounded describer, and returning ONE settled result —
 * description text plus the image block. The pixels it attaches are egressed
 * by the next pre-step pass (see egress.js).
 *
 * @module dsh-mm-resilience/tool
 */

const TOOL_NAME = 'mm_view_image'

const DESCRIPTION = [
  '查看当前会话中已粘贴并归档的图片（按 attachmentId，如 sha256:…）。返回归档时的机器描述，并在本次结果中附上原图像素。',
  '与 read_image 的区别：read_image 读取文件系统路径的图片；本工具查看会话历史里用户粘贴过的图片。',
  '当描述不足以回答时、或用户明确要求重新看原图时调用。',
].join('')

const PARAMETERS = {
  type: 'object',
  properties: {
    attachmentId: { type: 'string', description: '归档标签中的图片 attachmentId（sha256:…）' },
  },
  required: ['attachmentId'],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    attachmentId: { type: 'string' },
    description: { type: 'string' },
    provider: { type: 'string' },
    model: { type: 'string' },
    mediaType: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    bytes: { type: 'integer' },
    name: { type: 'string' },
  },
  required: ['attachmentId', 'description', 'provider', 'model', 'mediaType', 'width', 'height', 'bytes'],
  additionalProperties: false,
}

/**
 * @param {object} deps
 * @param {{ resolveModelInfo: Function }} deps.llm
 * @param {{ describeImages(refs: object[], route: {provider: string, model: string} | null, signal?: AbortSignal): Promise<Map> }} deps.describer
 * @returns {object} ToolDefinition plus a `whenHandler` used as the register `when` condition.
 */
export function createViewImageTool({ llm, describer }) {
  async function imageCapable(provider, model, signal) {
    try {
      const info = await llm.resolveModelInfo(provider, model, signal)
      return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
    } catch {
      return false
    }
  }

  function resolveSurfaceRef(session, attachmentId) {
    const messages = typeof session?.deriveMessages === 'function' ? session.deriveMessages() : []
    for (const message of messages) {
      if (!Array.isArray(message?.content)) continue
      for (const block of message.content) {
        if (block?.type === 'image' && block.attachment?.attachmentId === attachmentId) return block.attachment
      }
    }
    return null
  }

  async function execute(args, exec) {
    const attachmentId = args?.attachmentId
    if (typeof attachmentId !== 'string' || attachmentId === '') {
      throw new Error('mm_view_image: attachmentId is required')
    }
    // Execute-time strict route gate (read_image's assertImageCapableRoute shape).
    const routed = exec.agent?.session?.requestHeader()?.config
    const provider = routed?.provider ?? exec.agent?.options?.provider
    const model = routed?.model ?? exec.agent?.options?.model
    if (typeof provider !== 'string' || provider === '' || typeof model !== 'string' || model === '') {
      throw new Error(`mm_view_image: the current model route could not be resolved for "${attachmentId}"`)
    }
    if (!(await imageCapable(provider, model, exec.signal))) {
      throw new Error(`mm_view_image: model "${model}" does not declare image input; switch to an image-capable model to view "${attachmentId}"`)
    }

    const found = resolveSurfaceRef(exec.agent?.session, attachmentId)
    if (found === null) {
      throw new Error(`mm_view_image: no archived image with attachmentId "${attachmentId}" on the session surface`)
    }

    let description = ''
    let describeRoute = { provider: '', model: '' }
    try {
      const described = await describer.describeImages([found], { provider, model }, exec.signal)
      const entry = described.get(attachmentId)
      if (entry !== undefined) {
        description = entry.text
        describeRoute = { provider: entry.provider, model: entry.model }
      }
    } catch {
      // describe is best-effort; the pixels still attach below
    }

    return {
      attachmentId,
      description,
      provider: describeRoute.provider,
      model: describeRoute.model,
      mediaType: found.mediaType,
      width: found.width,
      height: found.height,
      bytes: found.bytes,
      ...found.name === undefined ? {} : { name: found.name },
    }
  }

  return {
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    output: {
      schema: OUTPUT_SCHEMA,
      render(args, value) {
        const identity = value.name === undefined ? value.attachmentId : `${value.name} (${value.attachmentId})`
        const text = value.description === ''
          ? `[mm_view_image ${identity}] 机器描述不可用（解析失败或超时）；本次直接附原图。`
          : `[mm_view_image ${identity}] 归档描述（${value.provider}/${value.model}，可能不准确）：${value.description}`
        const attachment = {
          attachmentId: value.attachmentId,
          mediaType: value.mediaType,
          bytes: value.bytes,
          width: value.width,
          height: value.height,
          ...value.name === undefined ? {} : { name: value.name },
        }
        return [
          { type: 'text', text },
          { type: 'image', attachment },
        ]
      },
    },
    execute,
    /** register(def, { when }) condition — image-capable routes only. */
    whenHandler: async ({ modelSelection, signal }) => {
      const provider = modelSelection?.provider
      const model = modelSelection?.model
      if (typeof provider !== 'string' || typeof model !== 'string') return false
      return imageCapable(provider, model, signal)
    },
  }
}
