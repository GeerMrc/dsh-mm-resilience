# DSH 插件开发可复用模式（patterns / 经验沉淀）

> 基线钉版：`dsh-v0.2.2-rc.5` tag（harness 仓）。每次 DSH 升级后重验 file:line。
> P1-P5 遵循四要素纪律：场景 / 机制 / 配方 / 禁忌（含反例）；P6 为跨切纪律汇总表。

---

## P1. 上下文注入行——后端注入内容走官方折叠行

**场景**：插件需向模型注入描述/标签等内容，但不能污染用户的聊天气泡（前端与原生 DSH 交互一致原则）。

**机制**（rc.5 源码已核验）：
- DSH 聊天窗对 `source.kind ≠ 'user'` 的 `user/message` **一律渲染为"上下文注入行"**——折叠细行（图标+标题，点击展开正文），同技能目录/工作区指令/会话召回的呈现方式
- `event-projection.ts:56-72` 对自定义 kind 一等支持：`{role:'inject', label: kind 字符串}`（"MessageSourceMap is merge-extensible; keep an unknown producer visible by its durable kind"）
- `KNOWN_FORMS` 六值菜单（`event-projection.ts:38-39`）：

| form 值 | 语义 | 适用 |
|---|---|---|
| `instructions` | 工作区指令 | AGENTS.md |
| `catalog` | 技能目录 | 技能列表 |
| `snapshot` | 快照 | 会话快照 |
| `notice` | **通知** | 机器描述等插件注入 |
| `relay` | 中继 | 转发 |
| `recall` | 召回 | 跨会话引用 |

**配方**：
1. 在 `agent/pre-step` 回调中，**不修改用户消息**（仅打 `offloaded:true` 等标记）
2. 构造独立消息：`{id: crypto.randomUUID(), role:'user', content:[{type:'text',text:'…'}], source:{kind:'<命名空间化-kind>', form:'notice'}}`
3. 追加到 `decision.messages` 数组末尾（循环原样持久化）
4. 无内容可注入 → 返回 `null` → **不产生任何行**（连折叠行都没有）

**禁忌**：
- ❌ 不要把描述文本写进用户消息的 content（气泡污染，用户实测否决）
- ❌ 不要用 `source.kind = 'runtime-context'`（循环会替换丢弃）
- ❌ kind 字符串是可见的 producer 标签——**命名空间化**（如 `mm-image-archive` 而非 `archive`）
- 反例：隐身模式（描述不落任何表面）被否决——违反"模型可见⟺日志记录"铁律

**验证**：本插件 `src/blocks.js archiveContextMessage` + `tests/blocks.test.js` + `tests/integration.test.js A`

---

## P2. 插件页文档分离——meta.detail 双语用户文档

**场景**：插件页默认回退渲染 README.md（开发者内容直达终端用户，不合适）。

**机制**（rc.5 `boot/plugin-manager/src/bundle-detail.ts` + `util/plugin-detail/README.md`）：
- 文档顺序：① locale `<lang>.json` 的 `meta.detail` 指定文件 → ② 包 README → ③ 市场条目仓库 README
- **语言链**：`zh-Hans-CN` 依次读 `locale/zh-hans-cn.json`→`zh-hans.json`→`zh.json`→`en.json`
- **路径规则**：`/` 分隔、包根相对、`.md`/`.markdown` 后缀、无 `./..` 空段、无反斜杠、无 URL scheme
- **命名文件不存在 = 硬错**（不回退 README）

**配方**：
1. 写 `docs/plugin-page.zh.md` + `docs/plugin-page.en.md`（用户向：一句话定位+设置项+行为要点）
2. `locale/zh.json`：`{"meta":{"title":"…","description":"…","detail":"docs/plugin-page.zh.md"}}`
3. `locale/en.json` 同理指向 `.en.md`
4. README 顶部注明分工（开发者 vs 用户）
5. 契约测试锁定路径合法性与文件存在性

**禁忌**：
- ❌ 不要让 `meta.detail` 指向 README 期望回退——命名文件不存在时**硬错不回退**
- ❌ 路径不要含反斜杠、URL scheme、`.`/`..` 段——官方路径校验直接拒绝

**验证**：本插件 `tests/contract.test.js` meta.detail 断言

---

## P3. 设置卡官方同构——控制器提升与 StrictMode 陷阱

**场景**：插件设置卡须与官方「子智能体」卡视觉/交互一致。

**机制**：
- 官方模式 = 全套复用 `@deepseek-ai/dsh-client-ui-primitives`（SettingsForm/SettingsValueField/SettingsFormModel/settingsNumberField/Tooltip）
- **控制器必须提升至 `apply()`**（插件生命周期），**禁止在组件 `useState` 内创建 + `useEffect` 卸载时 dispose**——React StrictMode 双挂载回放中模型死而不再建，编辑永不重渲染，保存永久置灰

**配方**：
```js
function apply(ctx) {
  const controller = createCardController(ctx.configForms.get(NS)) // once
  ctx.effect(() => () => controller.dispose()) // plugin lifetime
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: PKG_NAME, locale: NS
  }, (props) => createElement(Card, {ctx, t, controller})))
}
```
- 卡片结构：单一区域 + auto-fit 网格 + 每字段标签内联 Tooltip ⓘ
- 布局 CSS 仅 7 条官方值规则（`.section padding:16px 0` / `.heading 13px/600` 等）

**禁忌**：
- ❌ 不手绘输入框/开关/保存条（官方组件自带完整交互链）
- ❌ 不在组件内 dispose 模型（StrictMode 双挂载致命）

**验证**：本插件 `client/index.js` + `tests/repro-form-model.test.js V1.F`（重挂载安全回归）

---

## P4. 对称接管/交还——官方配置行的双向管理

**场景**：插件"接管"官方参数（如 `requestImagePixelBudget`），须在禁用时自动"交还"。

**机制**：
- **接管**（`apply()` 对账）：有效值≠官方默认 → 仅补覆盖层**缺失**的路由行（显式值路由禁碰）
- **交还**（禁用时，双通道）：
  - 宿主 dispose 钩子（HMR 宿主）
  - **客户端 `plugin-manager/changed` 事件监听**（桌面主通道：无 HMR 宿主的 bundle 开关不卸载 fiber，但该事件经官方 remotes 转发，Web 客户端在重启前窗口存活）
- **守卫规则**：仅 unset 仍等于插件应用值的行；手工差异值永远保留
- **行存在性判定**：user 层（首选）→ value≠base 且 base 路由存在（回退）；仅用户层路由 = 缺失

**配方**：见 `src/handover.js`（`reconcileTakeover` + `revertHandover`）与 `client/index.js watchDisableHandover`（含 C1 冲突重试）

**禁忌**：
- ❌ 无 HMR 桌面端不要依赖 dispose 钩子做禁用交还（`reload()` 只静态重组不卸载 fiber）
- ❌ 不要 unset 值不等于自己应用值的行（用户手工值会被误删）

**验证**：`tests/handover.test.js`（8 项）+ `tests/client.test.js` disable handover 测试

---

## P5. 真模型测试方法——关键链路禁仅假件

**场景**：npm 发布的官方 UI 组件包（如 `dsh-client-ui-primitives`）无法在 node 直接 import（"环境即宿主"式捆绑，所有依赖声明为宿主提升）。

**机制**：npm 发布的 UI 组件包带 `./src/*` TS 源码导出；tsc 可本地编译出纯 JS 模型（无 CSS/重型依赖）。

**配方**：
1. `pnpm add -D @deepseek-ai/dsh-client-ui-primitives@<exact>`（利用 `./src/*` TS 源码导出）
2. `pretest` 脚本用 tsc 编译关键文件到 `.compiled/`：
   ```sh
   tsc node_modules/@deepseek-ai/dsh-client-ui-primitives/src/settings-form/form-model.ts \
     --outDir .compiled --module es2022 --target es2022 --skipLibCheck
   ```
3. 测试导入 `.compiled/form-model.js` 获得真实官方模型
4. `.compiled/` 加入 `.gitignore`（每次测试重新编译 = 类型兼容检查）
5. CSS/重型无关依赖（katex/shiki/micromark）用 stub loader 挡住

**禁忌**：
- ❌ 关键链路（保存/重置/交还）禁止仅用静态假件——模拟双向数据流（edit→dirty→save→land→reset→conflict）时假件必须有状态；静态假件曾让 revert 路径静默漏测。
- ❌ 不要裸 `import '@deepseek-ai/dsh-client-ui-primitives'`——它是"环境即宿主"式捆绑（零依赖声明），需 stub loader。

**验证**：`tests/repro-form-model.test.js V1.A-V1.H`（真模型 8 场景全链路）

---

## P6. 跨切纪律

| 纪律 | 要点 |
|---|---|
| **CHANGELOG 四要素** | bug 类：现象/根因/修复/预防；定夺类：现象/定夺/实现/锁定 |
| **版本对齐** | 桌面每次升级后核对 devDeps/tag 对齐；审核一律引用最新 tag |
| **Warn-only 降级** | 任何插件辅助功能不得阻塞主流程——try/catch + console.warn + 自愈兜底 |
| **无条件注册** | 插件页卡片注册不套 whileServed（宿主 ns 问题时整卡静默消失） |
| **volatile 解包** | schemastery volatile 字段解析为 `{get()}` 句柄；`materializeConfig` 统一读取 |
| **peerDeps 精确钉版** | `>=x.y.z-rc.a <major+1`；registry latest 可能指向占位版——用 next tag |
| **`private:true` 保留** | 发布日才移除（与契约测试同步） |

---

## P7. npm 发布 files 白名单——meta.detail 引用的文件必须入包

**场景**：插件使用 `meta.detail` 指向 `docs/plugin-page.{zh,en}.md`（P2 模式），但 npm 发布时 `files` 白名单遗漏了该文件——`meta.detail` 指向包内不存在的文件 = 官方规则**硬错**（不回退 README）→ 插件页报错。

**机制**：
- `files` 字段是 npm pack 的**白名单**——不在列表中的目录/文件不会进入 tarball
- `docs/` 目录同时包含内部治理文档（设计决策/故障报告等，不应公开）和用户文档（plugin-page，必须入包）——**不能整目录包含，须逐文件列出**
- DSH 官方规则：`meta.detail` 指向的文件不存在 = `plugin-manager/detail-unavailable` 错误（reason: `invalid`），**不会回退渲染 README**

**配方**：
```json
"files": [
  "src", "client", "locale", "cordis.patch.yml",
  "README.md", "CHANGELOG.md",
  "docs/plugin-page.zh.md", "docs/plugin-page.en.md"
]
```

**禁忌**：
- ❌ 不要 `"files": ["docs"]`——会把内部治理文档（design-decisions.md / fault-report 等）泄漏到公开 npm 包
- ❌ 不要凭记忆写 files 列表——发布前必跑 `npm pack --dry-run` 逐文件核对
- ❌ 契约测试仅锁定 `meta.detail` 路径合法性与**源码仓**文件存在性——**不检查 npm tarball 内是否存在**（本 bugg 的根因）

**预防**：发布流程中 `npm pack --dry-run` 后，**逐文件对照 `meta.detail` 值**确认目标文件在 tarball 内。可在 CI workflow 中加一步断言。

**事故记录**（v0.0.1 → v0.0.2）：
- 现象：v0.0.1 发布后插件页详情区报错（`meta.detail` 指向不存在的文件）
- 根因：`files` 白名单遗漏 `docs/plugin-page.*.md`（设计时只排除了内部文档，忘了用户文档也在 docs/ 里）
- 修复：`files` 数组逐文件加入两个 plugin-page 文档；升版 v0.0.2 发布
- 教训：**契约测试须覆盖 npm tarball 内容物**（不仅仅是源码仓存在性）

---

## P8. npm 发布全链路——首次手动 + 后续 OIDC 自动化

**场景**：第三方 DSH 插件首次发布到 npm，以及配置后续版本自动发布。

**机制**（npm 2026 认证体系）：
- npm 已关闭新 TOTP 注册——**Passkey/Security Key** 是唯一 2FA 形态
- 手动发布 = npm ≥ 11.7 + **用户交互终端** + 浏览器弹 npmjs.com 认证 → Touch ID 确认
- 自动发布 = **Trusted Publishing（OIDC）**：GitHub Actions `id-token: write` + npm ≥ 11.5.1 + `repository.url` 精确匹配
- 本机默认 npmmirror（中国镜像）——**所有 npmjs 操作必须显式 `--registry https://registry.npmjs.org`**

**配方**（完整发布流程）：

**首次发布（手动）**：
```sh
# 1. 认证（交互终端，弹浏览器 Touch ID）
npm login --registry https://registry.npmjs.org

# 2. 移除 private:true + 对应契约测试断言（同笔提交）

# 3. 打包验证（逐文件核对！）
npm pack --dry-run

# 4. 发布（弹浏览器 Passkey）
npm publish ./dsh-mm-resilience-X.Y.Z.tgz \
  --registry https://registry.npmjs.org --access public

# 5. 三重验证
npm view dsh-mm-resilience versions --registry https://registry.npmjs.org
npm view dsh-mm-resilience dist.shasum --registry https://registry.npmjs.org
shasum dsh-mm-resilience-X.Y.Z.tgz  # 须与上一行字节级一致
```

**OIDC 绑定（npmjs.com 包设置页，一次性）**：
1. 包页面 → Settings → Trusted Publisher → Add
2. 选 GitHub Actions，填 Owner / Repository / Workflow filename
3. ☑ Allow `npm publish`
4. 状态变为 "Pending validation"——**2 天内**须通过该 workflow 成功发布一次

**后续版本（全自动）**：
```sh
git tag v0.0.3
git push origin v0.0.3
# → CI 自动：pnpm test → npm pack → GitHub Release → npm publish（OIDC）
```

**CI workflow 关键点**（`.github/workflows/release.yml`）：
- `packageManager: "pnpm@10.11.0"` 必须在 package.json（否则 `pnpm/action-setup@v4` 报错）
- `npm install -g npm@11` 在 publish 前（Node 22 镜像自带 npm 10.x，OIDC 需 ≥ 11.5.1）
- 先推 main 再推 tag（GitHub 限制：同批推送不触发 workflow）

**禁忌**：
- ❌ 不要在 agent/no-TTY 环境跑 `npm publish`（EOTP 必败，认证 URL 随进程消亡）
- ❌ 不要建 bypass-2FA granular token（2027-01 起失去直接发布资格）
- ❌ 连续敏感操作失败会触发 24-72h 账号冻结——失败一次停手隔天再试
- ❌ 裸包名可能被 npm 反抢注策略拒绝（dsh-websearch 先例）——备选 scoped name 或双名模式
- ❌ npm 新发布 CDN 传播延迟 1~5 分钟（tarball 404 ≠ 发布失败；`dist.shasum` 在元数据中立即可查）

**踩坑实录**：
| 问题 | 根因 | 修复 |
|---|---|---|
| CI 首次运行 10s 失败 | package.json 缺 `packageManager` 字段 | 加 `"packageManager": "pnpm@10.11.0"` |
| SSH 推送被拒 | SSH key 关联 `Tosu100` 而非 `GeerMrc` | 改 HTTPS + gh credential helper |
| workflow 文件推送被拒 | gh token 缺 `workflow` scope | `gh auth refresh -s workflow`（浏览器 Touch ID） |
| tarball 404（发布后） | CDN 传播延迟（正常） | 等待；`dist.shasum` 在元数据中已可验证 |
| v0.0.1 插件页报错 | files 白名单遗漏 plugin-page docs | v0.0.2 逐文件加入（P7 详述） |
