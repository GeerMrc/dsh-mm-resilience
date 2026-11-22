# v0.0.1 发布日操作清单（Runbook）

> 本文档为发布日人工操作指引。**发布前须人工审核确认**（用户定夺），不自动执行。
> 版本纪律：v0.0.1 定档，下一版 v0.0.2 须人工审核后变更。

## 前提条件

- 本地仓库 HEAD = 发布提交（全套 83/83 绿）
- `npm whoami --registry https://registry.npmjs.org` 能通过（token 未过期）
- `gh auth status` 已登录 `GeerMrc`

## 阶段 A｜npm 认证（用户交互终端，不可自动化）

```sh
# 1. 检查 token（大概率已过期，17+ 天）
npm whoami --registry https://registry.npmjs.org
# 若 401/超时 → 重新登录（浏览器弹 npmjs.com → Touch ID/Passkey）
npm login --registry https://registry.npmjs.org
# 立即验证（token 有效期约 4 天，登录后立刻用）
npm whoami --registry https://registry.npmjs.org
```

**注意**：
- 本机默认 npmmirror——**所有 npmjs 操作必须显式 `--registry https://registry.npmjs.org`**
- 死 token 的 publish 报 **E404（权限伪装）** 而非 401——先 `npm whoami` 确认
- 连续敏感操作失败会触发 24-72h 账号冻结——失败一次停手隔天再试

## 阶段 B｜移除 private:true + 更新契约测试

```sh
# 1. package.json 移除 "private": true
# 2. tests/contract.test.js 移除 private 断言（约 line 23）
# 3. 确认全套测试绿
pnpm test
```

## 阶段 C｜创建 GitHub 仓库并推送

```sh
# 推 main 分支（先推分支再推 tag——同批推送不触发 workflow）
gh repo create GeerMrc/dsh-mm-resilience --public \
  --source . --remote origin --push
```

## 阶段 D｜首次发布（手动 + Passkey）

```sh
# 1. 打 tarball
npm pack

# 2. 首次发布（手动、交互终端、Passkey 确认）
npm publish ./dsh-mm-resilience-0.0.1.tgz \
  --registry https://registry.npmjs.org --access public

# 3. 验证
npm view dsh-mm-resilience versions dist-tags --registry https://registry.npmjs.org
npm view dsh-mm-resilience dist.shasum --registry https://registry.npmjs.org
# 与本地 shasum 对比
shasum dsh-mm-resilience-0.0.1.tgz
```

**防抢注注意**：bare name `dsh-mm-resilience` 可能被 npm 反抢注策略拒绝（dsh-websearch 先例）。若拒绝：
- 方案 A：换 scoped name `@maricgeer/dsh-mm-resilience`
- 方案 B：双名模式（scoped npm + bare tarball，参照 `dsh-websearch/scripts/pack.mjs`）

## 阶段 E｜OIDC 绑定（v0.0.2+ 自动发布）

1. 在 npmjs.com 包设置页 → **Trusted Publishing** → 添加：
   - Owner: `GeerMrc`
   - Repository: `dsh-mm-resilience`
   - Workflow: `release.yml`
2. **绑定须在发布日创建**（首次成功发布须在 2 天内，否则过期）
3. 之后 `git tag v0.0.2 && git push origin v0.0.2` → CI 自动测试+发布

## 阶段 F｜发布后验证

```sh
# 三项检查
npm view dsh-mm-resilience versions --json --registry https://registry.npmjs.org
# dist.shasum 字节级对比
npm view dsh-mm-resilience dist.shasum --registry https://registry.npmjs.org
shasum dsh-mm-resilience-0.0.1.tgz
# tarball HTTP 200
curl -sI https://registry.npmjs.org/dsh-mm-resilience/-/dsh-mm-resilience-0.0.1.tgz | head -1
```

## 安全纪律（来自 dont-do.md 归档）

| 规则 | 原因 |
|---|---|
| 一切 npmjs 操作显式 `--registry` | 本机默认 npmmirror |
| 不建 bypass-2FA granular token | 2027-01 起失去发布资格 |
| 失败后停手隔天 | 连续敏感操作触发冻结 |
| 先推 main 再推 tag | 同批推送不触发 workflow |
| 移除内部治理文档再发布 | 公开仓保留终态 |
