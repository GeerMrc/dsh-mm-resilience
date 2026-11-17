/* dsh-mm-resilience browser half — PREBUILT FACTORY FILE.
 *
 * Served by ClientModuleRegistry as a classic script (no transform): the only
 * top-level side effect is the window.__ModuleLoader__.load registration, per
 * the dsh-subagent-plus exemplar that runs on the installed 0.2.2-rc.3.
 *
 * Card architecture (proven subagent-plus pattern, NOT ui-primitives'
 * SettingsFormModel): a self-contained draft controller over the raw
 * ConfigForm port (getSnapshot/subscribe/mutate) with revision-fenced atomic
 * fieldOps save. Registered UNCONDITIONALLY on 'plugins.bundle.config'
 * (keyed by package name — the configured-ledger gate) so the card is always
 * visible on the plugin page and shows an honest unavailable state instead of
 * silently disappearing when the host namespace is not served.
 *
 * b1 pixel budget fans out to every llm-pi-ai provider route on save
 * (official cross-namespace channel — the Models page itself is a foreign
 * writer of llm-pi-ai): providers-keys-only iteration, revision-fenced
 * single atomic mutate, one re-read retry on conflict.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mm-resilience',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useState, useSyncExternalStore } = require('react')

    const NS = 'mm-resilience'
    const BUNDLE_KEY = 'dsh-mm-resilience'
    const LLM_NS = 'llm-pi-ai'
    const PIXEL_MIN = 262144
    const PIXEL_MAX = 4194304

    const zh = {
      cardTitle: '图片治理',
      summaryLine: '每张图片首次入会解析归档一次，此后请求零图片字节；原图可按需回看。',
      unavailable: '设置暂不可用（宿主未暴露 mm-resilience 命名空间）',
      enabledLabel: '启用图片解析归档',
      enabledHint: '关闭后本插件完全停用，恢复官方行为（历史归档标记不受影响）',
      on: '已启用',
      off: '已停用',
      pixelsLabel: '图片像素上限（宽×高总像素）',
      pixelsHint: '超出后由官方管线自动等比压缩再发送（例：2560×1440 → 约 1365×768）',
      pixelsHelp: '保存时应用到当前全部 pi-ai 模型路由（官方通道 requestImagePixelBudget）。注意：① 上限 2048×2048（入会归一化已封顶，再大无效）；② 不覆盖 DeepSeek 原生路由；③ 在模型页编辑过路由后请点「重新应用」。',
      preset: '预设',
      countLabel: '每条消息解析上限（张）',
      countHint: '一次输入的前 N 张图片生成机器描述，其余仅归档（不带描述，可 mm_view_image 回看）。官方另有硬性准入上限 20 张/条。',
      advTitle: '高级：解析路由与预算',
      advHint: '默认使用当前会话路由解析图片；如需专用视觉路由可在此指定。',
      providerLabel: '解析路由 Provider（留空=会话路由）',
      modelLabel: '解析路由 Model（留空=会话路由）',
      concurrencyLabel: '并发数（1-8）',
      timeoutLabel: '单次超时（毫秒）',
      totalLabel: '总额预算（毫秒）',
      save: '保存',
      discard: '丢弃修改',
      invalid: '存在无效值，已阻止保存',
      saved: '已保存',
      conflict: '版本冲突，请重试',
      failed: '保存失败',
      clean: '无改动',
      fanoutApplied: '像素上限已应用到 {n} 条 pi-ai 路由',
      fanoutNoProviders: '未发现 pi-ai 路由，跳过应用',
      fanoutUnavailable: 'llm-pi-ai 命名空间不可用，跳过应用',
      fanoutConflict: '路由写入版本冲突（可能有并发编辑），请再次保存重试',
      fanoutKept: '像素上限未改动，未重写路由；如需刷新请点「重新应用」',
      reapply: '重新应用',
      reset: '恢复默认',
    }
    const en = {
      cardTitle: 'Image Governance',
      summaryLine: 'Every image is parsed and archived once on first entry; later requests carry zero image bytes; originals re-viewable on demand.',
      unavailable: 'Settings unavailable (host does not serve the mm-resilience namespace)',
      enabledLabel: 'Enable image parse-and-archive',
      enabledHint: 'When off, the plugin is fully passive and official behavior applies (existing archive marks persist)',
      on: 'Enabled',
      off: 'Disabled',
      pixelsLabel: 'Image pixel budget (width×height total)',
      pixelsHint: 'Oversized images are proportionally downscaled by the native pipeline before sending (e.g. 2560×1440 → ~1365×768)',
      pixelsHelp: 'Saving applies to ALL current pi-ai routes (official channel, requestImagePixelBudget). Notes: ① capped at 2048×2048 (intake normalization ceiling); ② DeepSeek native routes not covered; ③ after editing routes on the Models page, press "Re-apply".',
      preset: 'Presets',
      countLabel: 'Per-message describe cap (images)',
      countHint: 'The first N pasted images get a machine description; the rest archive without one (re-viewable via mm_view_image). A separate official hard admission cap of 20/message exists.',
      advTitle: 'Advanced: describe route & budgets',
      advHint: 'By default the session route parses images; set a dedicated vision route here if needed.',
      providerLabel: 'Describe route provider (empty = session route)',
      modelLabel: 'Describe route model (empty = session route)',
      concurrencyLabel: 'Concurrency (1-8)',
      timeoutLabel: 'Per-call timeout (ms)',
      totalLabel: 'Total budget (ms)',
      save: 'Save',
      discard: 'Discard changes',
      invalid: 'Invalid values blocked saving',
      saved: 'Saved',
      conflict: 'Revision conflict, please retry',
      failed: 'Save failed',
      clean: 'No changes',
      fanoutApplied: 'Pixel budget applied to {n} pi-ai route(s)',
      fanoutNoProviders: 'No pi-ai routes found; application skipped',
      fanoutUnavailable: 'llm-pi-ai namespace unavailable; application skipped',
      fanoutConflict: 'Route write hit a revision conflict (concurrent edits?); save again to retry',
      fanoutKept: 'Pixel budget unchanged; routes not rewritten. Press "Re-apply" to refresh.',
      reapply: 'Re-apply',
      reset: 'Restore default',
    }

    const PAGE_CSS = [
      '.mmr-card{display:flex;flex-direction:column;gap:12px;max-width:720px;width:100%;}',
      '.mmr-section{border:.5px solid var(--dsw-alias-border-l2);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-surface-l1,transparent);}',
      '.mmr-label{font-size:13px;font-weight:500;line-height:1.4;}',
      '.mmr-hint{font-size:12px;opacity:.65;line-height:1.5;}',
      '.mmr-help{font-size:12px;opacity:.75;line-height:1.5;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px;margin-top:2px;}',
      '.mmr-input{height:34px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font-size:13px;padding:0 8px;width:220px;max-width:100%;box-sizing:border-box;}',
      '.mmr-input:focus{outline:none;border-color:var(--dsw-alias-accent,currentColor);}',
      '.mmr-input.mmr-invalid{border-color:var(--dsw-alias-danger,#e5484d);}',
      '.mmr-chip{height:28px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;font-size:12px;cursor:pointer;}',
      '.mmr-chip[aria-pressed="true"]{background:var(--dsw-alias-accent-soft,rgba(128,128,128,.2));}',
      '.mmr-switch{width:36px;height:20px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l2);position:relative;cursor:pointer;background:transparent;padding:0;}',
      '.mmr-switch-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:currentColor;opacity:.55;transition:left .15s ease;}',
      '.mmr-switch[aria-checked="true"] .mmr-switch-knob{left:18px;opacity:1;}',
      '.mmr-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
      '.mmr-btn{height:32px;padding:0 14px;border-radius:8px;font-size:13px;cursor:pointer;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:inherit;}',
      '.mmr-btn.mmr-primary{background:var(--dsw-alias-accent,#4c6ef5);border-color:transparent;color:#fff;}',
      '.mmr-btn:disabled{opacity:.5;cursor:default;}',
      '.mmr-status{font-size:12px;line-height:1.5;}',
      '.mmr-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}',
      '.mmr-invalidTag{font-size:12px;color:var(--dsw-alias-danger,#e5484d);}',
      'details.mmr-adv summary{cursor:pointer;font-size:13px;font-weight:500;}',
    ].join('\n')

    /** Narrow a ConfigForm to the controller's port (subagent-plus asFormPort). */
    function asFormPort(form) {
      return {
        getSnapshot: () => form.getSnapshot(),
        subscribe: (listener) => form.subscribe(listener),
        mutate: (ops, expectedRevision) => form.mutate(ops, expectedRevision),
      }
    }

    /** One `set` op per changed top-level field — a single atomic mutate. */
    function fieldOps(committed, draft) {
      const ops = []
      for (const key of Object.keys(draft)) {
        if (JSON.stringify(committed[key]) === JSON.stringify(draft[key])) continue
        ops.push({ op: 'set', path: [key], value: draft[key] })
      }
      return ops
    }

    /**
     * Draft controller over one namespace form: committed copy + draft,
     * subscribe/getSnapshot for useSyncExternalStore, revision-fenced atomic
     * save. Trimmed clone of the subagent-plus NamespaceFormController that
     * runs on the installed rc.3.
     */
    class FormController {
      #form
      #listeners = new Set()
      #unsubscribe
      #disposed = false
      #saving = false
      #state = { status: 'loading', value: undefined, draft: undefined, saved: false }

      constructor(form) {
        this.#form = form
      }

      init = () => {
        if (this.#unsubscribe !== undefined || this.#disposed) return
        this.#unsubscribe = this.#form.subscribe(() => this.#sync())
        this.#sync()
      }

      dispose = () => {
        this.#disposed = true
        this.#unsubscribe?.()
        this.#listeners.clear()
      }

      subscribe = (listener) => {
        this.#listeners.add(listener)
        return () => this.#listeners.delete(listener)
      }

      getSnapshot = () => this.#state

      edit = (mutate) => {
        const draft = this.#state.draft
        if (draft === undefined) return
        mutate(draft)
        this.#patch({ saved: false })
      }

      save = async () => {
        const { value, draft } = this.#state
        if (value === undefined || draft === undefined) return 'unavailable'
        if (this.#saving) return 'clean'
        const ops = fieldOps(value, draft)
        if (ops.length === 0) return 'clean'
        this.#saving = true
        this.#patch({})
        let accepted
        try {
          accepted = await this.#form.mutate(ops, this.#form.getSnapshot().revision)
        } catch {
          this.#saving = false
          return 'failed'
        }
        this.#saving = false
        if (this.#disposed) return accepted ? 'saved' : 'conflict'
        this.#sync()
        return accepted ? 'saved' : 'conflict'
      }

      #sync = () => {
        const snapshot = this.#form.getSnapshot()
        const ready = snapshot.status === 'ready' && typeof snapshot.value === 'object' && snapshot.value !== null
        const value = ready ? { ...snapshot.value } : undefined
        const patch = { status: ready ? 'ready' : snapshot.status === 'loading' ? 'loading' : 'unavailable', value }
        if (value !== undefined) patch.draft = { ...value }
        this.#patch(patch)
      }

      #patch = (patch) => {
        this.#state = { ...this.#state, ...patch }
        for (const listener of this.#listeners) listener()
      }
    }

    /**
     * Write `requestImagePixelBudget` into every current llm-pi-ai provider
     * route: providers-keys-only, one atomic mutate, revision-fenced with a
     * single re-read retry on conflict (audit-hardened fan-out).
     */
    async function fanOutPixelBudget(ctx, budget) {
      const form = ctx.configForms.get(LLM_NS)
      if (form === undefined) return { ok: false, reason: 'unavailable' }
      const attempt = async () => {
        const snapshot = form.getSnapshot()
        if (snapshot.status !== 'ready') return { ok: false, reason: 'unavailable' }
        const providers = snapshot.value?.providers
        if (providers === undefined || providers === null || typeof providers !== 'object') {
          return { ok: false, reason: 'no-providers' }
        }
        const routes = Object.keys(providers)
        if (routes.length === 0) return { ok: false, reason: 'no-providers' }
        const ops = routes.map((route) => ({
          op: 'set',
          path: ['providers', route, 'requestImagePixelBudget'],
          value: budget,
        }))
        let accepted
        try {
          accepted = await form.mutate(ops, snapshot.revision)
        } catch {
          return { ok: false, reason: 'conflict' }
        }
        return accepted ? { ok: true, count: routes.length } : { ok: false, reason: 'conflict' }
      }
      const first = await attempt()
      if (first.ok || first.reason !== 'conflict') return first
      return attempt()
    }

    /** Parse a bounded non-negative decimal integer; undefined when invalid. */
    function parseBoundedInt(text, min, max) {
      const trimmed = String(text ?? '').trim()
      if (!/^\d+$/.test(trimmed)) return undefined
      const parsed = Number(trimmed)
      if (parsed < min || parsed > max) return undefined
      return parsed
    }

    const PRESETS = [
      { label: '512×512', value: 512 * 512 },
      { label: '1024×1024', value: 1024 * 1024 },
      { label: '2048×2048', value: 2048 * 2048 },
    ]

    function NumberField(props) {
      const { label, hint, text, invalid, invalidLabel, onEdit, t } = props
      return createElement('div', null,
        createElement('label', { className: 'mmr-label' }, label),
        createElement('input', {
          className: invalid ? 'mmr-input mmr-invalid' : 'mmr-input',
          type: 'text', inputMode: 'numeric', value: text,
          'aria-invalid': invalid ? 'true' : undefined,
          onChange: (event) => onEdit(event.target.value),
        }),
        invalid ? createElement('span', { className: 'mmr-invalidTag' }, ` ${invalidLabel}`) : null,
        hint ? createElement('p', { className: 'mmr-hint' }, hint) : null)
    }

    function TextField(props) {
      const { label, hint, value, onEdit } = props
      return createElement('div', null,
        createElement('label', { className: 'mmr-label' }, label),
        createElement('input', {
          className: 'mmr-input', type: 'text', value,
          onChange: (event) => onEdit(event.target.value),
        }),
        hint ? createElement('p', { className: 'mmr-hint' }, hint) : null)
    }

    function Card(props) {
      const { ctx, t, controller } = props
      const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
      const [status, setStatus] = useState('')
      const [fanout, setFanout] = useState('')
      const [fieldInvalid, setFieldInvalid] = useState({})
      const [advancedOpen, setAdvancedOpen] = useState(false)
      const { value, draft, status: formStatus } = state
      if (formStatus !== 'ready' || draft === undefined) {
        return createElement('section', { className: 'mmr-section' },
          createElement('h3', { className: 'mmr-label' }, t('cardTitle')),
          createElement('p', { className: 'mmr-hint' }, t('unavailable')))
      }

      const editNumber = (key, text, min, max) => {
        const parsed = parseBoundedInt(text, min, max)
        setFieldInvalid((prev) => ({ ...prev, [key]: parsed === undefined }))
        if (parsed !== undefined) controller.edit((d) => { d[key] = parsed })
      }
      const editEnabled = () => controller.edit((d) => { d.enabled = !d.enabled })
      const editText = (key, text) => controller.edit((d) => { d[key] = text })

      const pixelsDirty = JSON.stringify(value.maxImagePixels) !== JSON.stringify(draft.maxImagePixels)

      const onSave = async () => {
        if (Object.values(fieldInvalid).some(Boolean)) {
          setStatus(t('invalid'))
          return
        }
        const outcome = await controller.save()
        setStatus(t(outcome === 'saved' ? 'saved' : outcome === 'conflict' ? 'conflict' : outcome === 'failed' ? 'failed' : outcome === 'clean' ? 'clean' : 'failed'))
        if (outcome !== 'saved' && outcome !== 'clean') {
          setFanout('')
          return
        }
        if (!pixelsDirty) {
          setFanout(t('fanoutKept'))
          return
        }
        const applied = await fanOutPixelBudget(ctx, draft.maxImagePixels)
        if (applied.ok) setFanout(t('fanoutApplied').replace('{n}', String(applied.count)))
        else if (applied.reason === 'no-providers') setFanout(t('fanoutNoProviders'))
        else if (applied.reason === 'unavailable') setFanout(t('fanoutUnavailable'))
        else setFanout(t('fanoutConflict'))
      }

      const onReapply = async () => {
        const applied = await fanOutPixelBudget(ctx, draft.maxImagePixels)
        if (applied.ok) setFanout(t('fanoutApplied').replace('{n}', String(applied.count)))
        else if (applied.reason === 'no-providers') setFanout(t('fanoutNoProviders'))
        else if (applied.reason === 'unavailable') setFanout(t('fanoutUnavailable'))
        else setFanout(t('fanoutConflict'))
      }

      const onDiscard = () => {
        controller.init()
        setStatus('')
        setFanout('')
        setFieldInvalid({})
      }

      return createElement('div', { className: 'mmr-card' },
        createElement('h3', { className: 'mmr-label' }, `${t('cardTitle')} (mm-resilience)`),
        createElement('p', { className: 'mmr-hint' }, t('summaryLine')),

        createElement('section', { className: 'mmr-section', key: 'enabled' },
          createElement('div', { className: 'mmr-row' },
            createElement('button', {
              className: 'mmr-switch', type: 'button', role: 'switch',
              'aria-checked': draft.enabled === true ? 'true' : 'false', onClick: editEnabled,
            }, createElement('span', { className: 'mmr-switch-knob' })),
            createElement('span', { className: 'mmr-label' }, t('enabledLabel')),
            createElement('span', { className: 'mmr-hint' }, draft.enabled === true ? t('on') : t('off'))),
          createElement('p', { className: 'mmr-hint' }, t('enabledHint'))),

        createElement('section', { className: 'mmr-section', key: 'limits' },
          createElement(NumberField, {
            key: 'pixels', label: t('pixelsLabel'), hint: t('pixelsHint'),
            text: String(draft.maxImagePixels ?? ''),
            invalid: fieldInvalid.maxImagePixels === true, invalidLabel: `${PIXEL_MIN}–${PIXEL_MAX}`,
            onEdit: (text) => editNumber('maxImagePixels', text, PIXEL_MIN, PIXEL_MAX), t,
          }),
          createElement('div', { className: 'mmr-row', key: 'presets' },
            createElement('span', { className: 'mmr-hint' }, t('preset')),
            PRESETS.map((preset) => createElement('button', {
              key: preset.label, type: 'button', className: 'mmr-chip',
              'aria-pressed': draft.maxImagePixels === preset.value ? 'true' : 'false',
              onClick: () => editNumber('maxImagePixels', String(preset.value), PIXEL_MIN, PIXEL_MAX),
            }, preset.label))),
          createElement('p', { className: 'mmr-help' }, t('pixelsHelp')),
          createElement(NumberField, {
            key: 'count', label: t('countLabel'), hint: t('countHint'),
            text: String(draft.maxDescribedPerMessage ?? ''),
            invalid: fieldInvalid.maxDescribedPerMessage === true, invalidLabel: '1–20',
            onEdit: (text) => editNumber('maxDescribedPerMessage', text, 1, 20), t,
          })),

        createElement('details', {
          className: 'mmr-adv', key: 'advanced',
          open: advancedOpen, onToggle: (event) => setAdvancedOpen(event.target.open),
        },
          createElement('summary', null, t('advTitle')),
          createElement('div', { className: 'mmr-section', style: { marginTop: '10px' } },
            createElement('p', { className: 'mmr-hint' }, t('advHint')),
            createElement(TextField, {
              label: t('providerLabel'), value: String(draft.describeProvider ?? ''),
              onEdit: (text) => editText('describeProvider', text),
            }),
            createElement(TextField, {
              label: t('modelLabel'), value: String(draft.describeModel ?? ''),
              onEdit: (text) => editText('describeModel', text),
            }),
            createElement(NumberField, {
              label: t('concurrencyLabel'),
              text: String(draft.describeConcurrency ?? ''),
              invalid: fieldInvalid.describeConcurrency === true, invalidLabel: '1–8',
              onEdit: (text) => editNumber('describeConcurrency', text, 1, 8), t,
            }),
            createElement(NumberField, {
              label: t('timeoutLabel'),
              text: String(draft.describeTimeoutMs ?? ''),
              invalid: fieldInvalid.describeTimeoutMs === true, invalidLabel: '1000–60000',
              onEdit: (text) => editNumber('describeTimeoutMs', text, 1000, 60000), t,
            }),
            createElement(NumberField, {
              label: t('totalLabel'),
              text: String(draft.describeTotalBudgetMs ?? ''),
              invalid: fieldInvalid.describeTotalBudgetMs === true, invalidLabel: '1000–120000',
              onEdit: (text) => editNumber('describeTotalBudgetMs', text, 1000, 120000), t,
            }))),

        createElement('div', { className: 'mmr-actions', key: 'actions' },
          createElement('button', { type: 'button', className: 'mmr-btn mmr-primary', onClick: onSave }, t('save')),
          createElement('button', { type: 'button', className: 'mmr-btn', onClick: onDiscard }, t('discard')),
          createElement('button', { type: 'button', className: 'mmr-btn', onClick: onReapply }, t('reapply')),
          status ? createElement('span', { className: 'mmr-status' }, status) : null,
          fanout ? createElement('span', { className: 'mmr-status' }, fanout) : null))
    }

    const inject = ['slots', 'locale', 'configForms']

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.mmrPage = ''
        style.textContent = PAGE_CSS
        document.head.append(style)
        return () => { style.remove() }
      })
      const controller = new FormController(asFormPort(ctx.configForms.get(NS)))
      ctx.effect(() => {
        controller.init()
        return () => controller.dispose()
      }, 'mm-resilience: plugins card form subscription')
      // Unconditional: the configured-ledger gate needs this live registration,
      // and the card renders its own honest unavailable state.
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE_KEY,
        locale: NS,
      }, (slotProps) => {
        const view = slotProps?.view ?? 'page'
        if (view === 'summary') return createElement('span', null, t('summaryLine'))
        return createElement(Card, { ctx, t, controller })
      }), 'mm-resilience: plugins page card')
    }

    exports.apply = apply
    exports.inject = inject
    exports.fanOutPixelBudget = fanOutPixelBudget
    return module.exports
  },
})
