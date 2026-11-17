# 故障报告：session-0e2f3132-8eed-4f7d-817e-820935ed04f6

> 取证正本：`~/.dsh/sessions/--Volumes-IPFSJK-Switch-Game-nxnative-dev--/session-0e2f3132-…/session.v4.jsonl`（1,236 行，seq 0→1234）；用户导出 zip（2026-11-16 02:50）为其 turn 6–8 子集，逐字一致。交叉源：`~/.dsh/storages/session_projcache/`、`~/.dsh/attachments/v1/objects/`、DSH 源码（0.2.2-alpha.2 = f3803c9697，与实机 rc.3 承重标识逐项核验一致）。

## 环境

- DSH 桌面客户端 0.2.2-rc.3（Info.plist；runtime 自报 rc.2 为上游自身不一致）
- 路由 `sz` → `https://api-llm.jzyai.com:8443/v1`（openai-responses）→ nginx → `127.0.0.1:28089` SGLang（Qwen3.8-27B-FP8，VL 架构）
- 所有请求：`{"provider":"sz","model":"Qwen3.8-27B-FP8","reasoningEffort":"medium","maxTokens":51200}`

## 时间线（+0800）

| 时间 | seq | 事件 | 结果 |
|---|---|---|---|
| 11-14 03:48 | — | 会话创建 | 13 轮 154 步 |
| 11-15 22:31 | 668 | 用户贴 **3 图**（530×219/480×632/338×197，7–16KB 基线 JPEG） | 轮 2 完成 |
| 11-15 22:56 | 928 | 用户再贴 **2 图**（567×227/345×227） | 轮 4 完成 |
| 11-16 00:21 | 1168 | 轮 5 完成 | 5 图在史，全部请求正常 |
| 00:24:07–26 | 1176–1186 | 轮 6 步 1–2（含同款带图历史的请求） | **成功** |
| **00:24:28.79** | **1191** | 轮 6 步 3：0 token，约 0.5s 即失败 `server_error: An exception occurred while loading multimodal data: ` / `PI_AI_ERROR` | **故障起点** |
| 00:24–10:35 | 1198–1234 | 用户 4 次「继续」 | 4 次同样失败 |
| 02:50 | — | 错误 zip 导出（轮 6–8 共 6 条错误记录） | — |
| ~21:09 | 1237+ | 旧版插件装后按键 5：offload seq 928 图[0] + 轮内重试仍失败 | 轮 11 错 |
| ~21:10–17 | 1255+ | 按键 6：offload 图[1] → **轮 12 完成**；轮 13 完成 | **恢复** |

全程 `llm/retry` 事件数为 **0**。

## 失败签名

逐字（assistant/attempt 流与 turn/end 原因一致，共 6 次）：

```
"message":"server_error: An exception occurred while loading multimodal data: ","code":"PI_AI_ERROR"
```

注意冒号后**空白**——SGLang `legacy_load_mm_data()` 裸 `StopIteration` 的特征；0 token 即死（服务端生成前多模态装载阶段失败）。

## 根因链（逐级实证）

1. **请求面**：追加式历史携带 5 张贴图，随每次请求全量重发。故障步新增仅：assistant 消息、`read README.md` 结果（第 104 行含字面 `--icon <image>`）、文本 system-reminder——同轮步 1–2 带同款图**2 秒前刚成功**，图片本身无辜。
2. **服务端**：错误串为 SGLang 专属；网关侧 `chat_template_enhanced.jinja` 的 `'image' in item` 对裸字符串退化为子串匹配 → `Mismatch: More 'IMAGE' tokens found than corresponding data provided`。生产恢复本身证明：**只要请求面含 ≥1 张活图，故障确定性复发**；图片移除后同网关（仍故障）即成功。
3. **为何零重试**：失败在 200-OK SSE 流内（`response.failed`），无 HTTP 状态可分类；pi-ai 把错误扁平化为 message（llm-pi-ai/stream.ts:34-41）→ `classifyPiAiError` 文本正则不中 → `PI_AI_ERROR`（不在 DEFAULT_RETRYABLE_CODES）→ 轮即刻终止。若 HTTP 500 状态存活，本应归类可重试 `SERVER`。
4. **为何永久卡死**：致毒内容（图片字节）在不可变历史中，重试派生同一请求面；DSH 原生 `compaction-image-offload` 仅由 `IMAGE_OFFLOAD_REQUIRED`（字节/像素预算超限）触发——7–16KB/≤567px 的图永远够不到该阈值。唯一反馈是用户「报错中断了」。
5. **解药**：客户端内容降级——移除活图（offload）后同一故障网关即成功。恢复非服务端自愈（部署记录：21:09 sz 路由仍处多模态故障）。

## DSH 架构因素（三缺口）

- **(a) 历史图片随请求重发**：`user/message` 内嵌图片块，请求面每轮全量派生，直到被标记 offloaded。
- **(b) 状态盲分类器**：入流 `server_error` 措辞 + 适配器丢弃状态 → `PI_AI_ERROR` 兜底 → 零重试、零恢复钩子。
- **(c) 无内容降级路径**：原生 offload 只认预算超限；对服务端内容拒绝无反馈环。

## 本插件的根治原理（v2 架构）

**混合式归档**：贴图在入会瞬间（`agent/pre-step` 待入会批次）被打上 `offloaded: true`（ImageBlock 文档明文认可的"message rewrite"来源），旁挂机器描述标签；此后**每一个请求从第一个起即零图片字节**（`projectOffloadedImages` 对任意来源的标记生效）。缩略图保留（持久消息仍含图片块）、回放零投影依赖、计价自动按占位文本。回看是唯一像素通道（mm_view_image），且其像素在下一个 pre-step 被有日志的 surface replace 出清。

**为何这结构性消灭故障类**：卡死需要图片字节**在请求面里**供故障网关拒绝；本设计下普通轮次请求面不含任何图片字节——网关的多模态管线永远无事可做。

## 与旧版（补救式）的边界

旧版（已卸载归档：`/Volumes/IPFSJK/Zcode/dsh-mm-resilience-archive-20261117.tar.zst`）以失败分类→offload 阶梯**事后治愈**（生产中 2 次按键救回本会话）。v2 按用户定向改为**纯预防、零补救**：不再有失败分类器/阶梯/自适应——不存在需要治愈的场景。
