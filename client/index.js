/* dsh-mm-resilience browser half — PREBUILT FACTORY FILE.
 *
 * Served by ClientModuleRegistry as a classic script (no transform): the only
 * top-level side effect is the window.__ModuleLoader__.load registration, per
 * the dsh-subagent-plus exemplar that runs on the installed 0.2.2-rc.3.
 *
 * The Plugins-page card mirrors the OFFICIAL 「子智能体」 card exactly
 * (SubagentCard.tsx pattern): flat sections with h3 headings, the official
 * SettingsForm save bar, SettingsValueField fields (已覆盖 badge, 恢复默认),
 * a Tooltip ⓘ beside each section heading, and a
 * SettingsFormModel over ctx.configForms.get('mm-resilience'), hoisted to
 * apply() with plugin-lifetime disposal (StrictMode-safe). No hand-drawn
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
      pixelsLabel: '图片像素上限（宽×高总像素）',
      pixelsTip: '默认值即官方默认（安装即接管一致态）；保存时应用到全部 pi-ai 模型路由，「恢复默认」同时清除各路由覆盖；上限 2048×2048（入会归一化封顶）；模型页改动过路由后改值→保存即可重新统一；DeepSeek 原生路由不受影响。',
      pixelsHint: '超出自动等比压缩（官方管线）；默认 2048×2048=官方默认；上限 2048×2048；保存时应用到全部 pi-ai 路由（改值→保存即可重新应用）',
      countLabel: '每条消息解析上限（张）',
      countTip: '对应官方每消息图片准入上限（20/条）的接管语义：默认 20=全部获描述；下调后超出部分仅归档（可 mm_view_image 回看），降低多图解析耗时与成本。',
      countHint: '前 N 张获机器描述，其余仅归档（可 mm_view_image 回看）；默认 20=官方每消息上限',
      concurrencyLabel: '多图解析并行数',
      concurrencyTip: '解析经会话当前所选模型进行（无独立路由；非多模态模型则解析不可用=预期行为）。此参数为贴图入会时单图描述调用的并发数，全部完成后主请求才发出，不与会话模型执行并行冲突。',
      concurrencyHint: '一条消息贴多图时同时进行的解析调用数（1–8，默认 4）；解析完成后主请求才发出',
      reset: '恢复默认', invalid: '无效值',
      savedNote: '已保存',
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
      pixelsLabel: 'Image pixel budget (width×height total)',
      pixelsTip: 'Default = the official default (install = takeover parity); saving applies to every pi-ai route and "Restore default" also clears per-route overrides; ceiling 2048×2048 (intake normalization cap); after Models-page route edits, change + save to re-unify; DeepSeek native routes unaffected.',
      pixelsHint: 'Oversized images auto-downscale (native pipeline); default 2048×2048 = official; ceiling 2048×2048; saving applies to all pi-ai routes (change + save to re-apply)',
      countLabel: 'Per-message describe cap (images)',
      countTip: 'Mirrors the official per-message admission cap (20/message): default 20 = all described; lower it and images beyond N archive without a description (re-viewable via mm_view_image), cutting multi-image parse time and cost.',
      countHint: 'First N pasted images get a machine description, the rest archive (re-viewable via mm_view_image); default 20 = official per-message cap',
      concurrencyLabel: 'Multi-image parse concurrency',
      concurrencyTip: 'Parsing uses the session\u2019s currently selected model (no separate route; non-multimodal models leave parsing unavailable by design). This bounds single-image describe calls at paste time; the main request waits for them and never races the session model.',
      concurrencyHint: 'Describe calls running at once for a multi-image paste (1–8, default 4); the main request waits until parsing finishes',
      reset: 'Restore default', invalid: 'Invalid',
      savedNote: 'Saved',
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
      '.mmrr-tip{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;background:transparent;color:var(--dsw-alias-label-secondary);padding:0;margin-left:4px;cursor:help;vertical-align:middle;}',
      '.mmrr-limits{display:grid;grid-template-columns:repeat(2,minmax(min(220px,100%),1fr));gap:16px;}',
      '.mmrr-cell{min-width:0;}',
      '.mmrr-reset{border:none;background:transparent;padding:6px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;}',
      '.mmrr-reset:hover{color:var(--dsw-alias-label-primary);}',
      '.mmrr-cell--wide{grid-column:1 / -1;}',
      '.mmrr-cell input{min-width:0;font-variant-numeric:tabular-nums;}',
      '.mmrr-note{display:block;margin:0;padding-top:8px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);}',
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

    /** Official-default values per UI field key (the takeover baseline). */
    const FIELD_DEFAULTS = { pixels: 4_194_304, count: 20, concurrency: 4 }
    /** UI field key → schema field key (committed values are schema-keyed). */
    const SCHEMA_KEY = { pixels: 'maxImagePixels', count: 'maxDescribedPerMessage', concurrency: 'describeConcurrency' }

    /**
     * Field label as a node: the label text with a hover ⓘ Tooltip beside
     * it, rendered inline inside the official field's own label row (the
     * official component renders `{props.label}` verbatim).
     */
    function labelWithTip(text, tip) {
      return createElement('span', null, text,
        createElement(Tooltip, { label: tip, side: 'bottom', delayMs: 300, maxWidth: 300, portal: true },
          createElement('span', { className: 'mmrr-tip', 'aria-label': tip, role: 'note' },
            createElement(IconInfoOutlineRegular, { size: 12 }))))
    }

    /**
     * User-directed semantics: the official 已覆盖 badge is suppressed
     * entirely (misleading); our 恢复默认 control shows exactly when the
     * effective value — the valid staged draft if editing, else the
     * committed value — differs from the official default, so editing back
     * to the default hides it immediately. A save that lands shows 已保存
     * in the status line instead of any badge.
     */
    function differsFromDefault(key, state, committed) {
      const staged = state.invalid ? undefined : Number(state.text)
      const effective = staged !== undefined && Number.isFinite(staged) ? staged : committed
      return effective !== undefined && effective !== FIELD_DEFAULTS[key]
    }

    function fanoutNote(t, applied) {
      if (applied.ok) return t('fanoutApplied').replace('{n}', String(applied.count))
      if (applied.reason === 'no-providers') return t('fanoutNoProviders')
      if (applied.reason === 'unavailable') return t('fanoutUnavailable')
      if (applied.reason === 'failed') return t('fanoutFailed')
      return t('fanoutConflict')
    }

    function Card(props) {
      // The controller is created ONCE in apply() and lives with the plugin
      // (official web-search/subagent card pattern). A component-lifecycle
      // dispose broke under React StrictMode's mount→unmount→remount replay:
      // the model was disposed and never recreated (useState does not
      // re-run), so edits never re-rendered and the official save stayed
      // disabled forever.
      const { ctx, t, controller } = props
      const { model, store, scope } = controller
      useEffect(() => {
        const snapshot = scope.getSnapshot()
        console.info('[mm-resilience] settings ns snapshot:', JSON.stringify({ status: snapshot.status, writable: snapshot.writable, revision: snapshot.revision }))
      }, [scope])
      const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
      const [note, setNote] = useState('')
      // Pixel staging drives the save-time fan-out: 'set' writes the value to
      // every pi-ai route; 'clear' (恢复默认) unsets the per-route overrides.
      const [pixelStaged, setPixelStaged] = useState(null)
      const actions = model.actions()
      const { shell } = state
      const disabled = !shell.writable || shell.saving
      const committed = scope.getSnapshot().value ?? {}

      const fieldProps = (key, labelKey, hintKey) => ({
        id: `mmrr-${key}`,
        label: labelWithTip(t(labelKey), t(`${key}Tip`)),
        hint: t(hintKey),
        numeric: true,
        ...state[key],
        overridden: false,
        overriddenLabel: '',
        resetLabel: t('reset'),
        invalidLabel: t('invalid'),
        disabled,
      })

      const differs = (key) => differsFromDefault(key, state[key], committed[SCHEMA_KEY[key]])
      const stageReset = (key) => {
        if (key === 'pixels') setPixelStaged('clear')
        actions.resetField(SCHEMA_KEY[key])
      }

      const onSave = async () => {
        const staged = pixelStaged
        const stagedText = state.pixels.text
        setNote('')
        await model.save()
        const after = model.shell()
        if (after.failed) {
          // Honest production telemetry: the save refused to land — surface
          // the namespace snapshot essentials so one desktop round-trip pins
          // the failing hop (all offline layers are proven correct).
          const snapshot = scope.getSnapshot()
          console.warn('[mm-resilience] save did not land:', JSON.stringify({ failed: after.failed, dirty: after.dirty, ns: { status: snapshot.status, writable: snapshot.writable, revision: snapshot.revision } }))
          setNote(`${t('saveDiag')}: status=${snapshot.status} writable=${snapshot.writable} revision=${snapshot.revision}`)
          return
        }
        setPixelStaged(null)
        if (staged === null) {
          setNote(t('savedNote'))
          return
        }
        const applied = await fanOutPixelBudget(ctx, staged === 'clear' ? null : Number(stagedText))
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
          // One merged user-settings region: three fields, no section
          // headings (the page already draws the plugin title/description).
          createElement('div', { className: 'mmrr-limits' },
            ...['pixels', 'count', 'concurrency'].map((key) => createElement('div', {
              className: key === 'concurrency' ? 'mmrr-cell mmrr-cell--wide' : 'mmrr-cell',
              key: `cell-${key}`,
            },
              createElement(SettingsValueField, {
                ...fieldProps(key, `${key}Label`, `${key}Hint`),
                onEdit: (text) => {
                  if (key === 'pixels') setPixelStaged('set')
                  actions.edit(SCHEMA_KEY[key], text)
                },
                onReset: () => stageReset(key),
              }),
              differs(key) ? createElement('button', {
                type: 'button', className: 'mmrr-reset', onClick: () => stageReset(key),
              }, t('reset')) : null)))),
        shell.available && note ? createElement('span', { className: 'mmrr-note', role: 'status' }, note) : null)
    }

    const inject = ['slots', 'locale', 'configForms']

    /** One card controller per plugin lifetime (official web-search pattern):
     * the SettingsFormModel is created once, bound once, and disposed only
     * when the plugin fiber goes away — never on component unmount. */
    function createCardController(form) {
      const model = new SettingsFormModel(form, [
        boundedField('maxImagePixels', PIXEL_MIN, PIXEL_MAX),
        boundedField('maxDescribedPerMessage', 1, 20),
        boundedField('describeConcurrency', 1, 8),
      ])
      const store = model.bind(() => ({
        shell: model.shell(),
        pixels: model.field('maxImagePixels'),
        count: model.field('maxDescribedPerMessage'),
        concurrency: model.field('describeConcurrency'),
      }))
      return { model, store, scope: form, dispose: () => { model.dispose() } }
    }

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
      const controller = createCardController(ctx.configForms.get(NS))
      ctx.effect(() => () => { controller.dispose() }, 'mm-resilience: form subscription')
      // Unconditional: the configured-ledger gate needs this live registration,
      // and the card renders the official unavailable state when unserved.
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE_KEY,
        locale: NS,
      }, (slotProps) => {
        const view = slotProps?.view ?? 'page'
        if (view === 'summary') return createElement('span', null, t('summary'))
        return createElement(Card, { ctx, t, controller })
      }))
    }

    exports.apply = apply
    exports.inject = inject
    exports.fanOutPixelBudget = fanOutPixelBudget
    return module.exports
  },
})
