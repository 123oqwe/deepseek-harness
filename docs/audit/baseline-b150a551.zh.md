# Clean-baseline health receipt — R0.3A

> **已作废——仅作审计出处，不再是活跃 gate 输入。** 根据 maintainer 决策 A1
> （`spec/first100/exec/decisions-approved.md`，2026-08-31 批准），
> `first100-exec` 已从 `b150a551b8` 重新基线到 BASE-ALIGN 时的上游 `master`
> 最新提交 `0a53fb55bea101816fa226bb964ae2bed71c343b`。以下所有事实（HEAD、
> 退出码、失败列表）均针对已退役的 `b150a551b8` SHA，不描述 `0a53fb55`。
> 本 receipt 的结论行——"W1 remains BLOCKED"——随之作废：对新基线而言，
> 它既未被确认也未被推翻，因为尚未对 `0a53fb55` 做过任何采集。当前、
> 范围正确的 gate 状态记录在 `spec/first100/exec/r0-gate-baseline-transition.json`；
> `spec/first100-r0-evidence.json` 中仍处于 OPEN 的四项（`nativeTestFullSuite`、
> `packInstall`、`runnerDryReceipt`、`independentReviewReceipts`）必须针对
> `0a53fb55` 重新采集，任何 W1 slice 才能开始。

[English](baseline-b150a551.md) | 中文

Status: EVIDENCE CAPTURED — R0 exit gate item 1 stays OPEN pending a quiet-machine/CI full-suite exit-0 confirmation
Clean base: `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (frozen baseline, master tip)
Provenance: pristine git worktree at `/tmp/dsh-baseline-b150a551b8`, detached at the frozen SHA, 0 porcelain
Host: macOS, Node v24.18.0, pnpm 11.7.0; load avg ~50–52 on 10 cores (external desktop apps: Chrome, fseventsd, trustd, WeChat, OrbStack, ToDesk; 9 users)
Captured: 2026-08-27

## Purpose

R0 exit gate 第 1 项要求干净分支的原生 CI/pack 在冻结基线上为绿，且独立于任何
First-100 工作。本 receipt 记录原生 keyless pipeline
（`install → build → test → pack → verify-packed-install`）的真实
command/exit/HEAD 证据，并如实说明每个退出码证明什么。

## 1. Identity

- HEAD = `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（正是冻结的 SHA）
- 捕获时 `git status --porcelain` = 0 项
- Node `v24.18.0`；pnpm `11.7.0`；`pnpm config get registry` = `https://registry.npmjs.org/`

## 2. Command/exit table — real exits captured directly from `$?` (never through a pipe)

| step | command | real exit | evidence |
|---|---|---|---|
| install | `pnpm install --frozen-lockfile` | **0** | `/tmp/r03a-1-install.log` — 31s 完成。一条非致命 WARN：examples 工作区的一个 bin 符号链接（`dsh-acp-demo`）无法创建，因为该 demo 包的 `lib/bin.js` 在安装时尚未构建；pnpm 退出 0。 |
| build (CI-equivalent) | `DSH_BUILD_CLIENT_PROFILE=official pnpm run build` | **0** | `/tmp/r03a-7-build-official.log`；构建记录 `.dsh-build/client-build-environment.json` 已写入：`{DSH_CLIENT_BUILD_PROFILE:official, DSH_CLIENT_COMMIT_HASH:b150a55, DSH_CLIENT_TITLE:DeepSeek Harness}`，200 个 client artifact，digest 绑定到当前树。这正是 CI `build` gate 设置的环境。 |
| build (plain) | `pnpm run build` | **0** | `/tmp/r03a-2-build.log` — 200 个 client artifact，1 个 public value。 |
| test (full suite, controlled) | `pnpm exec vitest run --maxWorkers 4` | **1** | `/tmp/r03a-5-full-controlled.log` — `Test Files 8 failed | 855 passed | 9 skipped (872)`；`Tests 12 failed | 14581 passed | 114 skipped (14707)`；1085.5s。全部 12 个失败都是环境性的（见下）。 |
| pack — dsh family | `pnpm exec tsx scripts/release/pack.ts --family dsh` | **0** | `/tmp/r03a-8-pack-dsh.log` — `dist/npm` 中 227 个 tarball，publish order 已记录。 |
| pack — vendor family | `pnpm exec tsx scripts/release/pack.ts --family vendor --out dist/npm-vendor` | **0** | `/tmp/r03a-9-pack-vendor.log` — 9 个 tarball。 |
| verify-packed-install (official script) | `pnpm exec tsx scripts/release/verify-packed-install.ts --family dsh --from dist/npm --from dist/npm-vendor` | **1** | 脚本 `--omit=optional` 在 macOS 上的特定局限，不是载荷缺陷（见下）。 |
| (supplementary) consumer install, optional deps INCLUDED | `npm install --no-audit --no-fund --package-lock=false`（全新 `npm_config_cache`） | **0** | `/tmp/r03a-12-consumer-install.log` — 236 个打包 tarball + 全部 optional deps 干净安装。 |
| (supplementary) installed entry probe | `node node_modules/@deepseek-ai/dsh/lib/bin.js --version` | **0** | 打印 `0.1.1-rc.2` — 打包后的 `@deepseek-ai/dsh` CLI 能加载并报告 tarball 版本。 |

## 3. Test-suite failures — all environmental, none a baseline defect

12 个失败的测试分布在 8 个文件。失败集合在 35 文件子集重跑与完整受控运行之间
**完全一致**，证明该类别在本机负载下是确定的，而不是隐藏的代码缺陷：

| file | failures | cause |
|---|---|---|
| `packages/boot/app-boot/tests/hmr-config.spec.ts` | 4 | 负载 52 下的 `eventually`/watch 时序抖动 |
| `packages/boot/app-boot/tests/user-patches.spec.ts` | 1 | 负载下的 watch/文件事件时序 |
| `packages/client/ui-primitives/tests/code-block.client.spec.tsx` | 1 | 负载下的懒加载/时序 |
| `packages/examples/agent-spine-demo/tests/agent-core.spec.ts` | 1 | 负载下的 spawn/时序 |
| `packages/shell/bash-local/tests/executor.spec.ts` | 1 | macOS `/tmp` → `/private/tmp` 符号链接工件，来自本 worktree 放在 `/tmp` 下（断言期望 `/private/tmp/...`）；不是代码缺陷 |
| `packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts` | 2 | 负载下的文件系统 watch 时序 |
| `packages/typert/generator/tests/tools-catalog.spec.ts` | 1 | 负载下的时序 |
| `scripts/oxlint-contract.spec.ts` | 1 | 负载下耗时 77.5s |

负载 52 下的默认并行 `pnpm test`（无 `--maxWorkers`）在 35 个文件上产生 83 个时序
抖动标记，35 分钟未结束——这是 CPU 饥饿工件，不是代码错误。记录的证据是受控的
`--maxWorkers 4` 运行。

## 4. Pack + verify-packed-install findings

- 两个 family 都干净打包（dsh 227，vendor 9），且 dsh pack gate
  `readClientBuildRecord(root, officialClientBuildEnvironment(root))` 通过：
  官方 profile 的构建记录与冻结 HEAD 及当前 artifact 逐字节一致。
- 官方 `verify-packed-install` 脚本在这台 macOS 主机上退出 1，有两个已记录原因，
  二者都不是载荷缺陷：
  1. 本机过期的 npm 缓存提供了被截断的 `@earendil-works/pi-ai` packument
     （latest `0.80.10`），因此 consumer 的 `npm install` 在
     `@earendil-works/pi-ai@^0.82.1` 上 `ETARGET` 失败。换用全新缓存后，注册表
     确实能解析 `0.82.1`（注册表元数据 `latest` = `0.84.3`，`0.82.1` 已发布）。
     keyless 复现：`npm view --cache
     /tmp/fresh-npm-cache --prefer-online @earendil-works/pi-ai@0.82.1 version`
     → `0.82.1`。
  2. 脚本硬编码 `npm install --omit=optional`。koffi@3.1.1 把每个平台的预编译
     （`@koromix/koffi-<platform>`）声明为 `optionalDependencies`；省略它们会
     丢掉 `@koromix/koffi-darwin-arm64`，于是 koffi 的 install 脚本退回原生源码
     构建，而该构建在 macOS arm64/AppleClang 17 上链接 libuv 符号
     （`_uv_poll_start`、`_uv_ref`、…）失败。基线自己的 pnpm install（包含
     optional deps）则能正常从 darwin-arm64 预编译加载 koffi。
- 打包闭合健全的补充性 keyless 证明：同样 236 个 tarball、但不带 `--omit=optional`
  （全新缓存）的 consumer 安装退出 0，安装后的 `@deepseek-ai/dsh --version` 探针
  打印 `0.1.1-rc.2`。CI 在 Linux runner 上运行官方脚本，那里的 koffi 源码构建
  预期可以链接。

## 5. Honesty — what this receipt does and does not establish

- **确实建立：** 冻结基线能干净安装、构建（普通与 CI 精确的 `official` profile 两种）
  并打包；打包载荷完整，运行时闭合在本机健全（补充性探针）。
- **并未建立：** 在这台共享机器上全套件 `pnpm test` 退出 0。12 个失败已证明为
  环境性，但第 1 项的措辞（"native CI/pack green"）只有在安静机器或 Linux CI
  确认套件退出 0 后才完全满足。**第 1 项保持 OPEN**，直到该确认被捕获。
- 干净基线中未预创建任何 First-100 特性；这里没有移植或修复 PR95 专属故障
  （见 `packaging-migration-ledger.md` §3）。
- First-100 保持 0/100 ACCEPTED；W1 保持 BLOCKED，直到 R0 exit gate 真正满足。
