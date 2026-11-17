/* dsh-mm-resilience browser half — PREBUILT FACTORY FILE.
 *
 * Served by ClientModuleRegistry as a classic script (no transform): the only
 * top-level side effect is the window.__ModuleLoader__.load registration, per
 * the dsh-subagent-plus exemplar that runs on the installed 0.2.2-rc.3.
 *
 * The Plugins-page card mirrors the OFFICIAL 「子智能体」 card exactly
 * (SubagentCard.tsx pattern): flat sections with h3 headings, the official
 * SettingsForm save bar, SettingsValueField fields (ⓘ help, 已覆盖 badge,
 * 恢复默认), a Tooltip ⓘ beside each section heading, and a
 * SettingsFormModel over ctx.configForms.get('mm-resilience'). No hand-drawn
 * control chrome remains. Schema defaults ARE the official takeover values,
 * so each field's official 恢复默认 restores the DSH default; resetting the
 * pixel budget also unsets the fanned-out provider overrides.
 *
 * Registered UNCONDITIONALLY on 'plugins.bundle.config' (keyed by package
 * name — the configured-ledger gate) so the card is always visible on the
 * plugin page and shows the official unavailable state otherwise. The
 * bundle's Plugins-page enable switch is the plugin's only on/off.
 */
window.__ModuleLoader__.load({
  id: 'dsh-mm-resilience',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const { createElement, useEffect, useState, useSyncExternalStore } = require('react')
    const {
      SettingsForm, SettingsValueField, SettingsFormModel, settingsNumberField,
      Tooltip, IconInfoOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives')

    const NS = 'mm-resilience'
    const BUNDLE_KEY = 'dsh-mm-resilience'
    const LLM_NS = 'llm-pi-ai'
    const PIXEL_MIN = 262144
    const PIXEL_MAX = 4194304

    const zh = {
      formUnavailable: '设置暂不可用', formReadOnly: '只读', formSaveFailed: '保存失败',
      save: '保存', saving: '保存中…',
      sectionLimits: '图片上限',
      sectionLimitsTip: '默认值即 DSH 官方默认（安装即接管一致态）。像素上限保存时应用到全部 pi-ai 模型路由，「恢复默认」同时清除各路由覆盖；DeepSeek 原生路由不受影响。',
      sectionParsing: '图片解析',
      sectionParsingTip: '解析经会话当前所选模型进行；非多模态模型则解析不可用（归档不带描述）。并行数为贴图入会时的前置描述并发，完成后主请求才发出。',
      pixelsLabel: '图片像素上限（宽×高总像素）',
      pixelsHint: '超出自动等比压缩（官方管线）；默认 2048×2048=官方默认；上限 2048×2048；保存时应用到全部 pi-ai 路由',
      countLabel: '每条消息解析上限（张）',
      countHint: '前 N 张获机器描述，其余仅归档（可 mm_view_image 回看）；默认 20=官方每消息上限',
      concurrencyLabel: '多图解析并行数',
      concurrencyHint: '一条消息贴多图时同时进行的解析调用数（1–8，默认 4）；解析完成后主请求才发出',
      overridden: '已覆盖', reset: '恢复默认', invalid: '无效值',
      reapply: '重新应用到全部路由',
      saveDiag: '保存未落库（诊断信息）',
      fanoutApplied: '像素上限已应用到 {n} 条 pi-ai 路由',
      fanoutNoProviders: '未发现 pi-ai 路由，跳过应用',
      fanoutUnavailable: 'llm-pi-ai 命名空间不可用，跳过应用',
      fanoutConflict: '路由写入版本冲突（可能有并发编辑），请再次保存重试',
      fanoutFailed: '路由写入失败（网络/传输错误），请重试',
      summary: '每张图片首次入会解析归档一次，此后请求零图片字节；原图可按需回看。',
    }
    const en = {
      formUnavailable: 'Settings unavailable', formReadOnly: 'Read-only', formSaveFailed: 'Save failed',
      save: 'Save', saving: 'Saving…',
      sectionLimits: 'Image Limits',
      sectionLimitsTip: 'Defaults ARE the DSH official defaults (install = takeover parity). The pixel budget applies to every pi-ai route on save; "Restore default" also clears per-route overrides; DeepSeek native routes are unaffected.',
      sectionParsing: 'Image Parsing',
      sectionParsingTip: 'Parsing uses the session\u2019s currently selected model; non-multimodal models leave parsing unavailable (archived without description). Concurrency bounds the pre-entry describe calls; the main request waits for them.',
      pixelsLabel: 'Image pixel budget (width×height total)',
      pixelsHint: 'Oversized images auto-downscale (native pipeline); default 2048×2048 = official; ceiling 2048×2048; applies to all pi-ai routes on save',
      countLabel: 'Per-message describe cap (images)',
      countHint: 'First N pasted images get a machine description, the rest archive (re-viewable via mm_view_image); default 20 = official per-message cap',
      concurrencyLabel: 'Multi-image parse concurrency',
      concurrencyHint: 'Describe calls running at once for a multi-image paste (1–8, default 4); the main request waits until parsing finishes',
      overridden: 'Overridden', reset: 'Restore default', invalid: 'Invalid',
      reapply: 'Re-apply to all routes',
      saveDiag: 'Save did not land (diagnostics)',
      fanoutApplied: 'Pixel budget applied to {n} pi-ai route(s)',
      fanoutNoProviders: 'No pi-ai routes found; application skipped',
      fanoutUnavailable: 'llm-pi-ai namespace unavailable; application skipped',
      fanoutConflict: 'Route write hit a revision conflict (concurrent edits?); save again to retry',
      fanoutFailed: 'Route write failed (network/transport error); please retry',
      summary: 'Every image is parsed and archived once on first entry; later requests carry zero image bytes; originals re-viewable on demand.',
    }

    /* Official-mirrored layout styles only (fields and the save bar bring
     * their own chrome from ui-primitives). */
    const PAGE_CSS = [
      '.mmrr-section{min-width:0;padding:16px 0;}',
      '.mmrr-headingRow{display:flex;align-items:center;gap:6px;}',
      '.mmrr-heading{margin:0;font-size:13px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary);}',
      '.mmrr-tip{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;cursor:default;}',
      '.mmrr-limits{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:16px;}',
      '.mmrr-cell{min-width:0;}',
      '.mmrr-cell input{min-width:0;font-variant-numeric:tabular-nums;}',
      '.mmrr-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);}',
      '.mmrr-actions{display:flex;align-items:baseline;gap:12px;padding-top:8px;}',
      '.mmrr-reapply{border:none;background:transparent;padding:0;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;}',
      '.mmrr-reapply:hover{color:var(--dsw-alias-label-primary);}',
    ].join('\n')

    /**
     * A numeric field spec that only accepts integers within [min, max]
     * (the official subagent limitField pattern: out-of-range drafts become
     * invalid inline instead of failing at the host schema on save).
     */
    function boundedField(field, min, max) {
      const numeric = settingsNumberField(field)
      return {
        ...numeric,
        parse: (text) => {
          const write = numeric.parse(text)
          if (write === undefined || write.kind !== 'set') return write
          const value = write.value
          return Number.isSafeInteger(value) && value >= min && value <= max ? write : undefined
        },
      }
    }

    /**
     * Write (set or unset) the pixel budget into every current llm-pi-ai
     * provider route: providers-keys-only, one atomic mutate, revision-fenced
     * with a single re-read retry on conflict. `budget === null` restores the
     * official default by UNSETTING the per-route override.
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
        const ops = routes.map((route) => (budget === null
          ? { op: 'unset', path: ['providers', route, 'requestImagePixelBudget'] }
          : { op: 'set', path: ['providers', route, 'requestImagePixelBudget'], value: budget }))
        let accepted
        try {
          accepted = await form.mutate(ops, snapshot.revision)
        } catch {
          return { ok: false, reason: 'failed' }
        }
        return accepted ? { ok: true, count: routes.length } : { ok: false, reason: 'conflict' }
      }
      const first = await attempt()
      if (first.ok || first.reason !== 'conflict') return first
      return attempt()
    }

    function HeadingWithTip(props) {
      const { id, text, tip } = props
      return createElement('div', { className: 'mmrr-headingRow' },
        createElement('h3', { className: 'mmrr-heading', id }, text),
        createElement(Tooltip, { label: tip, side: 'bottom', delayMs: 300, maxWidth: 300, portal: true },
          createElement('button', { type: 'button', className: 'mmrr-tip', 'aria-label': tip },
            createElement(IconInfoOutlineRegular, { size: 12 }))))
    }

    function fanoutNote(t, applied) {
      if (applied.ok) return t('fanoutApplied').replace('{n}', String(applied.count))
      if (applied.reason === 'no-providers') return t('fanoutNoProviders')
      if (applied.reason === 'unavailable') return t('fanoutUnavailable')
      if (applied.reason === 'failed') return t('fanoutFailed')
      return t('fanoutConflict')
    }

    function Card(props) {
      const { ctx, t, form } = props
      const [model] = useState(() => new SettingsFormModel(form, [
        boundedField('maxImagePixels', PIXEL_MIN, PIXEL_MAX),
        boundedField('maxDescribedPerMessage', 1, 20),
        boundedField('describeConcurrency', 1, 8),
      ]))
      const [store] = useState(() => model.bind(() => ({
        shell: model.shell(),
        pixels: model.field('maxImagePixels'),
        count: model.field('maxDescribedPerMessage'),
        concurrency: model.field('describeConcurrency'),
      })))
      useEffect(() => {
        const snapshot = form.getSnapshot()
        console.info('[mm-resilience] settings ns snapshot:', JSON.stringify({ status: snapshot.status, writable: snapshot.writable, revision: snapshot.revision }))
        return () => { model.dispose() }
      }, [model, form])
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const [note, setNote] = useState('')
      // Pixel staging drives the save-time fan-out: 'set' writes the value to
      // every pi-ai route; 'clear' (恢复默认) unsets the per-route overrides.
      const [pixelStaged, setPixelStaged] = useState(null)
      const actions = model.actions()
      const { shell, pixels, count, concurrency } = state
      const disabled = !shell.writable || shell.saving

      const fieldProps = (fieldState, key, labelKey, hintKey) => ({
        id: `mmrr-${key}`,
        label: t(labelKey),
        hint: t(hintKey),
        numeric: true,
        ...fieldState,
        overriddenLabel: t('overridden'),
        resetLabel: t('reset'),
        invalidLabel: t('invalid'),
        disabled,
      })

      const onSave = async () => {
        const staged = pixelStaged
        const stagedText = pixels.text
        setNote('')
        await model.save()
        const after = model.shell()
        if (after.failed) {
          // Honest production telemetry: the save refused to land — surface
          // the namespace snapshot essentials so one desktop round-trip pins
          // the failing hop (all offline layers are proven correct).
          const snapshot = form.getSnapshot()
          console.warn('[mm-resilience] save did not land:', JSON.stringify({ failed: after.failed, dirty: after.dirty, ns: { status: snapshot.status, writable: snapshot.writable, revision: snapshot.revision } }))
          setNote(`${t('saveDiag')}: status=${snapshot.status} writable=${snapshot.writable} revision=${snapshot.revision}`)
          return
        }
        setPixelStaged(null)
        if (staged === null) return
        const applied = await fanOutPixelBudget(ctx, staged === 'clear' ? null : Number(stagedText))
        setNote(fanoutNote(t, applied))
      }

      const onReapply = async () => {
        // The COMMITTED value, never the staged draft (an unsaved or invalid
        // draft must not be fanned out to every route).
        const committed = ctx.configForms.get(NS).getSnapshot().value?.maxImagePixels
        if (typeof committed !== 'number' || !Number.isFinite(committed)) return
        const applied = await fanOutPixelBudget(ctx, committed)
        setNote(fanoutNote(t, applied))
      }

      return createElement('div', null,
        createElement(SettingsForm, {
          labels: {
            unavailable: t('formUnavailable'),
            readOnly: t('formReadOnly'),
            saveFailed: t('formSaveFailed'),
            save: t('save'),
            saving: t('saving'),
          },
          state: shell,
          onSave,
          onDiscard: actions.discard,
        },
          createElement('section', { className: 'mmrr-section', key: 'limits', 'aria-labelledby': 'mmrr-limits-h' },
            createElement(HeadingWithTip, { id: 'mmrr-limits-h', text: t('sectionLimits'), tip: t('sectionLimitsTip') }),
            createElement('div', { className: 'mmrr-limits' },
              createElement('div', { className: 'mmrr-cell', key: 'cell-pixels' },
                createElement(SettingsValueField, {
                  ...fieldProps(pixels, 'pixels', 'pixelsLabel', 'pixelsHint'),
                  onEdit: (text) => { setPixelStaged('set'); actions.edit('maxImagePixels', text) },
                  onReset: () => { setPixelStaged('clear'); actions.resetField('maxImagePixels') },
                })),
              createElement('div', { className: 'mmrr-cell', key: 'cell-count' },
                createElement(SettingsValueField, {
                  ...fieldProps(count, 'count', 'countLabel', 'countHint'),
                  onEdit: (text) => actions.edit('maxDescribedPerMessage', text),
                  onReset: () => actions.resetField('maxDescribedPerMessage'),
                })))),
          createElement('section', { className: 'mmrr-section', key: 'parsing', 'aria-labelledby': 'mmrr-parsing-h' },
            createElement(HeadingWithTip, { id: 'mmrr-parsing-h', text: t('sectionParsing'), tip: t('sectionParsingTip') }),
            createElement('div', { className: 'mmrr-limits' },
              createElement('div', { className: 'mmrr-cell', key: 'cell-concurrency' },
                createElement(SettingsValueField, {
                  ...fieldProps(concurrency, 'concurrency', 'concurrencyLabel', 'concurrencyHint'),
                  onEdit: (text) => actions.edit('describeConcurrency', text),
                  onReset: () => actions.resetField('describeConcurrency'),
                }))))),
        createElement('div', { className: 'mmrr-actions' },
          createElement('button', { type: 'button', className: 'mmrr-reapply', onClick: onReapply }, t('reapply')),
          note ? createElement('span', { className: 'mmrr-note', role: 'status' }, note) : null))
    }

    const inject = ['slots', 'locale', 'configForms']

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.mmrrPage = ''
        style.textContent = PAGE_CSS
        document.head.append(style)
        return () => { style.remove() }
      })
      // Unconditional: the configured-ledger gate needs this live registration,
      // and the card renders the official unavailable state when unserved.
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE_KEY,
        locale: NS,
      }, (slotProps) => {
        const view = slotProps?.view ?? 'page'
        if (view === 'summary') return createElement('span', null, t('summary'))
        return createElement(Card, { ctx, t, form: ctx.configForms.get(NS) })
      }))
    }

    exports.apply = apply
    exports.inject = inject
    exports.fanOutPixelBudget = fanOutPixelBudget
    return module.exports
  },
})
