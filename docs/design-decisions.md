# 设计决策留痕（v2 从零重建，2026-11-17）

> 依据：三路独立对抗审核（全部 file:line 实证 @ f3803c9697 = 0.2.2-alpha.2，且承重标识对实机 rc.3 app.asar 逐一核验）+ 5 项执行期核验。每条记录：裁定、证据、落地位置。

## 二次审核的 6 条修正

### 1. 混合式归档（否定"文本标签替换图片块"）

- **裁定**：pre-step 改写待入会批次是官方在契约内明测的机制（interception.spec.ts:178），但把图片块**替换成纯文本**会让客户端缩略图永久消失（MessageItem.tsx 渲染持久 user/message 的图片块），且放弃官方计价/压缩策略等一切图片块消费者。
- **正解**：图片块保留原身份，仅标 `offloaded: true`——ImageBlock 文档（llm/src/types.ts:86-96）明文"preserved by a message rewrite"是合法来源；`projectOffloadedImages`（content.ts:251-267）对任意来源标记生效。
- **落地**：`src/blocks.js` rewriteMessage。

### 2. 不自建第三套数量上限（否定 batch-only cap M）

- **裁定**：官方已有两层——入会准入 `maxImagesPerMessage`（默认 20，硬拒+横幅，admitPromptContent 连已存储图计数）与路由级预算+官方 offload。
- **正解**：自建上限改为"每条消息**解析描述**上限"（描述是唯一的每图成本：一次辅助视觉调用）；官方硬性准入上限在文案中如实披露。
- **落地**：`src/config.js` maxDescribedPerMessage（1–20，默认 8）。

### 3. describe 调用必须可归因（"Model-visible ⟺ logged"）

- **裁定**：无 envelope 记录的模型请求违反 AGENTS.md:137 不变量。官方先例：compaction/summary 记 envelope、session/title-llm-request 记全请求。
- **树外通道核验**：`appendPluginRecord` 运行时无守卫，但 README 明文"仓库外插件亦不得调用"（规范禁止）——**不采用**。
- **正解**：来源行内嵌进归档标签（provider/model/时间随文本块持久化，天然入日志）；describe 输入=代码常量提示词+已日志化附件对象（与 compaction 单发豁免同类）；`purpose` 闭合 union 为官方保留，树外省略。
- **落地**：`src/blocks.js` archiveTag + `src/describe.js`。

### 4. 回看像素必须出清（否定"轮末静默清理"）

- **裁定**：tool/result 是表面事件，随每请求重发——read_image 源码自认图片"must never enter durable history"。`agent/turn-stopping` **不在 error 轮触发**（agent.ts:402-418 catch 路径先于 :396 rethrow）。
- **正解**：出清移到**每个 pre-step**（每个模型请求前必经）：对表面所有含活图的 tool/result 追加官方 pruner 模式的单节点 `surfaceOp:'replace'`（同 callId、仅 content 变化、sourceEventSeqs 引用）——error 轮/中断/重启全覆盖，幂等，纯持久事件、无自定义投影（插件禁用后零砖风险）。
- **落地**：`src/egress.js`（surface.nodes + eventAt，与官方 compaction-tool-result-pruner 同一对 API）。

### 5. 工具条件注册（否定全量注册）

- **裁定**：全局注册让每个会话/子代理/PTC 付 schema token 成本；纯文本路由上工具无用。
- **正解**：`register(def, {when})` 官方条件暴露（image-capable 路由才可见）+ execute 时严格路由门（read_image 的 assertImageCapableRoute 同款）+ 描述中与 read_image 明确区分（attachmentId vs 文件路径）。
- **落地**：`src/tool.js`。

### 6. b1 跨命名空间 fan-out 为架构正解（v1 直觉被证实）

- **裁定**：官方四张插件页卡均写他包命名空间；Models 页本身即 llm-pi-ai 的外来写入者；subagent-plus（三方、实机在用）写官方 subagent ns。**无请求时替代通道**（llm/stream 仅包 chunk；agent/request 已弃用无图像字段；imageRequestTarget 适配器内部单射）。
- **加固**：仅遍历 llm-pi-ai providers 键、revision 栅栏+冲突单次重试、单原子 mutate 最小路径 op。
- **披露**：>2048² 无效（入会归一化 DEFAULT_NORMALIZED_IMAGE_MAX_PIXELS 封顶）→ 预设 512²/1024²/2048²；DeepSeek 原生路由（per-model imagePixelBudget）不覆盖。
- **落地**：`client/index.js` fanOutPixelBudget。

## 5 项执行期核验结果

| # | 问题 | 结论 |
|---|---|---|
| 1 | appendPluginRecord 树外立场 | 运行时可用但规范明文禁止 → 弃用，来源行内嵌 |
| 2 | llm purpose 闭合 union 树外传参 | 无运行时校验、适配器仅识别官方两值 → 省略不传 |
| 3 | attachment-local maxImagesPerMessage 是否 volatile | **否**（grep 零 volatile）→ settings 不可写 → b2 走自有解析上限 |
| 4 | turn-stopping 是否覆盖 error 轮 | **否**（catch 先 rethrow）→ 出清改 pre-step（见修正 4） |
| 5 | surfaceOp:'replace' tool/result 规格 | startSeq===endSeq、须为当前表面节点、**仅 content 可变**（深度相等校验）、sourceEventSeqs 在 append 选项且须含被遮蔽节点 → pruner 参照实现逐字段落地 |

## 其他关键接线事实（已核验，不再重查）

- 插件契约 = subagent-plus 0.0.4 同款（rc.3 asar 逐标识核验）
- 插件页 `plugins.bundle.config` 只传 `{view:'page'}` 不传 form → 卡片自走 configForms；configured 门=注册 key===包名 → **无条件注册**（v1 的 whileServed 门是卡片静默消失的结构性根因）
- schemastery volatile 字段解析为 `{get()}` 句柄（v1 激活崩溃根因）→ materializeConfig 统一读取
- `AbortSignal.timeout` 定时器 unref——空事件循环永不触发 → describe 改显式 ref'd 定时器
- `user/message` 事件 data 即消息本体；`tool/result` 为 `{turn,step,message}` 包装
- 同步历史读取（snapshotEvents/eventAt/ownEvents）已弃用；官方 pruner 以 waiver 使用 surface.nodes+eventAt——本插件镜像该对（跟随官方迁移）

## 独立对抗复审（4c，实现完成后）——NEEDS FIXES → 全部闭环

| # | 级别 | 发现 | 修复 |
|---|---|---|---|
| 1 | 🔴 | 出清在 pre-step N+1 开头执行，而像素本应搭乘的恰是 N+1 的请求（preStep→append→buildRequest 顺序）——回看像素从未到达任何模型请求 | **rode-once 围栏**：per-session EgressState（seen + requestedSinceSeen，调用方在决策后写入 enter）；仅"上一轮已见且其后有请求派生"的结果被出清——搭乘恰一次；重启后至多多搭一轮（留痕） |
| 2 | 🟠 | volatile 原位提交不重跑 apply——配置快照冻结，设置卡开关/路由/上限重启前全部失效 | **live config**：rawConfig 保留，每事件 materializeConfig（纯函数）；enabled 按事件门控；工具 execute 时检查 enabled |
| 3 | 🟡 | 总预算只挡"新开调用"——在途调用可超时至 budget+timeout（默认 25s，极限 180s） | **批级硬期限**：deadline AbortController（ref'd 定时器）经 AbortSignal.any 注入每个在途调用——最坏上界=预算本身 |
| 4 | 🟡 | surface.nodes/eventAt 缺失时静默降级——安全网死掉零诊断 | 一次性 warn（模块级去重） |
| 5 | 🟡 | NumberField 受控于最后一个有效值——清空/输入前缀时显示回弹 | 本地文本 override（parse 回到 draft 值即跟随）+ 丢弃时 resetToken 重挂载；FormController 增 reset() |

复审确认的正面结论：6 条修正全部按代码落地（file:line 勾稽）；契约与 subagent-plus 0.0.4 零漂移；66 项测试无空洞断言；**核心预防目标（贴图零字节搭乘任何请求）完整正确**。修复后 68/68。

## 附录：设置卡官方对齐重构（2026-11-18，用户三轮定向）

### 用户定夺

1. 排版对齐官方「子智能体」插件页卡（`plugins.item` 官方专属不可用 → 第三方保持 `plugins.bundle.config` 通道 + 全套复用官方 ui-primitives 组件：SettingsForm/SettingsValueField/SettingsFormModel/settingsNumberField/Tooltip/IconInfoOutlineRegular）；弃 subagent-plus 式"设置页卡片堆叠"
2. 解析路由 Provider/Model 移除——路由永远随会话输入框所选模型（打破 session 执行路径的独立路由入口=混乱源；非多模态模型→解析不可用即正确行为；OCR/MCP 属未来独立插件）
3. 字段=官方参数接管：默认值=官方默认（像素 4,194,304=llm-pi-ai DEFAULT_REQUEST_IMAGE_PIXEL_BUDGET；解析上限 20=attachment-local DEFAULT_MAX_IMAGES_PER_MESSAGE）；恢复默认=官方原生 resetField（清除用户层→重继承默认）
4. 卡片内零开关：总开关=插件页官方启停开关（关闭→官方自动接管；宿主无 HMR 时可能需重启生效——已披露 README）
5. 小字说明=区块标题旁 ⓘ 圆图标+官方 Tooltip 悬停（仿插件页顶标题样式）；字段长披露入官方 help ⓘ
6. 仅保留并发数（多图解析并行数）；超时/预算固化常量（10s/15s）+测试缝参数

### E1 独立计划审核（APPROVE-WITH-FIXES，8 项全采纳）

| # | 修正 | 落地 |
|---|---|---|
| 1 | 图标导出名：IconInfoOutlineRegular（IconInfo 不存在） | client/index.js |
| 2 | 客户端数值范围校验（官方 limitField 模式，越界行内标红） | boundedField |
| 3 | **恢复默认必须同步 unset 路由侧覆盖**（此前仅 set——"回退官方"只对一半；providers 祖先 volatile 使 unset 合法） | fanOutPixelBudget(budget===null → unset ops) |
| 4 | onSave 接线：await model.save()+shell().failed 检查+像素暂存判定（set/clear 二态）驱动 fan-out | Card onSave |
| 5 | 冒烟测试需 fake ui-primitives 模块 | client.test.js |
| 6 | describe 常量测试缝（timeoutMs/totalBudgetMs 可选参数） | createDescriber |
| 7 | README：总开关语义+可能需重启披露+测试计数修正 | README |
| 8 | 历史决策文档补 supersession 注（默认 8→20、enabled 门移除） | 本附录 |

### 历史条目 supersession 注

- 「二次审核修正 2」中 maxDescribedPerMessage 默认 8 → **已被官方接管值 20 取代**（本轮定夺 3）
- 「复审修复 2」的 per-event enabled 门 → **已移除**（总开关=插件页官方启停，本轮定夺 4）
- 「复审修复 5」NumberField 本地文本 override → **随手绘字段一并废弃**（官方 SettingsValueField 自带草稿/校验/恢复默认）

## 附录 2：已覆盖/恢复默认值语义偏离（2026-11-18，用户定夺）

官方 form-model 的 overridden=**用户层存在性**（"an override equal to the composition default is still an override"）。用户实测反馈该语义误导（改回默认仍显示、未保存即显示），定夺改为**有效值≠官方默认**：有效值=合法草稿（编辑中）否则已提交值；invalid 草稿回退已提交值。实现于卡片层（withOverrideRule 包装 model.field 状态），模型/存储层不动（保存/重置/unset 语义不变）。风险注记：若用户保存了"等于默认"的覆盖并期望徽标提示存在性，该信息不再展示（值即默认=无行为差异，无实际损失）。
