# Agent Note: First-100 clean-baseline health and packaging ledger (R0.3A/3B)

Status: implemented

[English](2026-08-27-first100-clean-baseline-health-packaging-ledger.md) | 中文

## Problem

First-100 的合并回退从干净基线开始：冻结的 master 尖端 `b150a551b8`，没有预创建任何 First-100 特性，也没有提前移植任何 PR95 pack/运行时闭合故障。在 W1 可以开始之前，R0 exit gate 第 1 项要求干净分支的原生 CI/pack 为绿，第 3 项要求每个特性都有明确的所有者和合并回退路径。没有捕获的证据，「基线是健康的」只是断言而非事实，打包迁移也会是一个无人负责的计划。

## Decision

两个工件现在记录基线的状态：

- `docs/audit/baseline-b150a551.md` — R0.3A receipt。在一个 detach 到冻结 SHA 的原始 worktree 上，运行原生 keyless pipeline，并直接从 `$?` 捕获每个退出码：`pnpm install --frozen-lockfile` 退出 0；CI 构建（`DSH_BUILD_CLIENT_PROFILE=official pnpm run build`）退出 0，官方 client-build record 的 digest 绑定到 HEAD；`pnpm run build` 退出 0；`release:pack --family dsh` 退出 0（227 个 tarball），`--family vendor` 退出 0（9 个 tarball）；完整受控 vitest 套件（14,707 个测试，`--maxWorkers 4`）退出 1，恰好 8 个文件的 12 个失败，全部被证明是环境性的（外部负载约 52 / 10 核下的 11 个负载时序/watch/懒加载 + 该 worktree 放在 `/tmp` 下导致的 `executor.spec.ts` `/tmp`→`/private/tmp` 符号链接工件）。
- `docs/audit/packaging-migration-ledger.md` — R0.3B ledger：合并回退规则（每个 wave 一次版本号提升；首次进入交付组成的包必须在同一个 micro-PR 内通过 pack/install + 闭合 smoke）、9 行 PR95 故障登记表（REGISTERED、未移植；每行标注 owner wave），以及 W1–W19 特性 owner 表。

两个 pack 发现被如实记录而非「修复」：官方 `verify-packed-install` 脚本在这台 macOS 主机上退出 1——先是本机过期的 npm 缓存提供了被截断的 `@earendil-works/pi-ai` packument（换用全新缓存可正常解析 lockfile 中的 `0.82.1`），随后因为脚本硬编码的 `--omit=optional` 丢弃了 koffi@3.1.1 的 `@koromix/koffi-darwin-arm64` 预编译（声明为 `optionalDependency`），迫使其原生源码构建在 arm64/Node 24 上链接 libuv 符号失败。一个补充性的 keyless 安装（同样的 236 个 tarball，包含 optional deps）退出 0，且安装后的 `@deepseek-ai/dsh --version` 探针打印 `0.1.1-rc.2`，证明打包载荷与运行时闭合是健全的。因此 receipt 的结论是 R0 exit gate 第 1 项保持 **OPEN**，待安静机器或 Linux CI 的全套件退出 0 确认。

## Alternatives considered

**因为 install/build/pack 都退出 0 就声称基线为绿。** 拒绝：receipt 不得夸大。即使是全套件退出 1——即便每个失败都单独证明为环境性——仍不能满足第 1 项的措辞，因此 receipt 记录强健康证据并把第 1 项保持 OPEN。

**修改或绕过 `verify-packed-install` 以在 macOS 上强行通过。** 拒绝：基线已冻结，脚本是已发布的门。macOS 上的退出 1 是其 `--omit=optional` 设计在此工具链上的已记录局限，而非载荷缺陷；补充安装已经证明闭合。

## Consequences

干净基线的健康现在是可捕获、可复查的事实而非断言，打包迁移每个特性都有 owner 和明确的合并回退规则。First-100 保持 0/100 ACCEPTED，W1 保持 BLOCKED：R0 exit gate 第 1 项（全套件退出 0 确认）、第 3 项（ledger owner——已写入，但仍需 gate 的完整确认）与第 5 项（R0-7 维护者批准 + 签名 envelope）仍未完成。本 slice 没有向干净基线移植任何 First-100 特性或 PR95 故障。
