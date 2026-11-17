# dsh-mm-resilience

DSH 桌面客户端（0.2.2-rc.3 已核验）第三方插件：**图片解析归档复用**——每张图片首次入会时解析一次并归档打标，此后所有请求零图片字节重发，从根源上消灭"多模态网关故障卡死会话"这一故障类（[故障报告](docs/fault-report-session-0e2f3132.md)）。

## 工作原理（纯预防，零补救）

```
贴图 ──pre-step──▶ 图片块标 offloaded:true（缩略图保留）
                 + 旁挂机器描述标签（含 provider/model 来源行）
                        │
所有后续请求 ◀── projectOffloadedImages：图片字节→官方占位文本
                        │
模型/用户明示回看 ──▶ mm_view_image 工具（下一个请求附原图恰好一次）
                        │
下一个 pre-step ──▶ 有日志的 surface replace 出清像素
```

- **解析一次**：贴图瞬间经当前会话路由（或专用视觉路由）做一次单图描述调用（有界并发/单次超时/总额硬预算——在途调用随期限中止/attachmentId 缓存）；失败=仅归档不带描述，绝不阻塞发送。
- **终身复用**：持久化的 user/message 即档案；同图重贴同 attachmentId 直接命中缓存。
- **明示回看**：`mm_view_image(attachmentId)`（与原生 `read_image` 的区别：本工具按会话内 attachmentId 查看贴图，read_image 读文件路径）；仅在视觉路由上暴露；像素随其后的第一个请求传递恰好一次，再下一个请求前出清（重启后至多多搭一轮）。
- **禁用即回退**：插件页关闭开关 → 立即停用（设置实时生效，无需重启）；已归档标记持久保留（官方语义），旧会话照常可读。

## 设置卡（DSH 插件页 → dsh-mm-resilience）

| 设置 | 默认 | 说明 |
|---|---|---|
| 启用图片解析归档 | 开 | 总开关；关闭=官方行为 |
| 图片像素上限 | 1024×1024 | 超出由**官方管线**自动等比压缩再发送（面积语义：2560×1440 → 约 1365×768）。保存时应用到当前全部 pi-ai 路由 |
| 每条消息解析上限 | 8 | 一次输入前 N 张生成描述，其余仅归档（可回看） |
| 高级：解析路由/并发/超时/总额预算 | 会话路由 / 4 / 10s / 15s | 需要专用视觉路由时指定 |

**像素上限的三条诚实披露**：① 上限封顶 2048×2048（入会归一化已截断，再大无效）；② 不覆盖 DeepSeek 原生路由；③ 在模型页编辑过路由后请点「重新应用」。

## 安装 / 卸载

```sh
# 安装（桌面 profile）
cd ~/.dsh/profiles/desktop
# package.json: dependencies 加 "dsh-mm-resilience": "link:/Volumes/IPFSJK/Zcode/dsh-mm-resilience"
#              dsh.profile.bundles 加 "dsh-mm-resilience"
pnpm install   # 完全退出并重启 DSH（ClientModuleRegistry 负缓存，热改不生效）
```

卸载=删除上述两处条目 + `pnpm install` + 重启。DSH 客户端本体（/Applications）零改动。

## 桌面验收清单（重启 DSH 后）

1. ☐ 插件页出现 dsh-mm-resilience 卡片（开关/像素上限/解析上限/高级，官方风格）
2. ☐ DevTools 控制台无 mm-resilience 报错；Network 中 `/plugins/dsh-mm-resilience/client.js` 返回 200
3. ☐ 贴一张截图：会话内缩略图**保留**、其下出现"[图片已归档 …] 机器解析（路由/模型，可能不准确）…"标签
4. ☐ 网络面板：贴图后的**第一个**模型请求体中无图片 base64（仅占位文本+描述）
5. ☐ 追问"图里第三个按钮是什么"：模型可直接据描述回答，或调用 mm_view_image 回看
6. ☐ 像素上限改 512×512 → 保存 → 贴 2K 图 → 请求体明显变小（官方管线压缩）
7. ☐ 每条消息解析上限改 1 → 连贴 2 图 → 第一张有描述、第二张"未解析（超出每条消息解析上限…）"
8. ☐ 关闭开关 → 新贴图不再归档（官方行为）；重新开启恢复

## 开发

```sh
pnpm install
pnpm test        # node --test，66 项（契约门/单测/契约保真集成）
```

- `src/` 宿主半：config / blocks（混合式重写）/ describe（有界描述通道）/ egress（pruner 模式出清）/ tool / index（pre-step 接线）
- `client/index.js` 预构建工厂文件（经典 script，无构建工具）
- `docs/design-decisions.md` 全部设计裁定与证据（二次审核 6 修正 + 5 项核验）

## 版本纪律

v0.0.1，全本地，零远端；升版与发布须经人工定夺。
