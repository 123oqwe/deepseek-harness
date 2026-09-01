# Baseline fingerprint 报告格式 — `pnpm baseline:capture`（P0-01 C 阶段样本）

[English](baseline-fingerprint-0a53fb55bea101816fa226bb964ae2bed71c343b.md) | 中文

Status: CONTRACT SPECIMEN。这是 `pnpm baseline:capture` 写入
`docs/audit/baseline-fingerprint-<gitSha>.md` 的报告所遵循的规范格式示例，
作为 P0-01 C 阶段（contract）micro-PR 的一部分编写。
`scripts/release/baseline-fingerprint.mjs` 尚不存在——那是 P0-01 的 P
阶段——因此本文件是一个人工编写的样本，contract test
（`tests/release/baseline-fingerprint.spec.ts`）与机器文件样本
（`.dsh/baseline.json`）都依据它校验各自的字段结构，而不是一次由工具真实生成
的采集。它描述的是冻结基线 `0a53fb55bea101816fa226bb964ae2bed71c343b`
（`tests/first100/registry.json` 的 `frozenBaseline`），这也是本样本的 SHA
与 `.dsh/baseline.json` 的 `gitSha` 一致的原因。

本文件与 `docs/audit/baseline-0a53fb55.md` 属于不同的产物类别：那份文件是
Supervisor 自己的 R0.3A 原生 CI/pack 治理健康 receipt（测试套件结果证据）；
本文件记录的是 `baseline:capture`/`baseline:verify` 产出并检查的
Git-SHA+Node/pnpm 版本+workspace 包列表+协议 schema hash 指纹格式。路径拆分
记录在 `tests/first100/adjudication.json` 的
`deliverablePathPatches.entries.P0-01`（BLOCKED-001）中：
`docs/audit/baseline-<sha>.md` 仍保留给 Supervisor 治理 receipt；
`baseline:capture` 家族使用 `docs/audit/baseline-fingerprint-<sha>.md`。

## 1. Identity

- 冻结基线 SHA：`0a53fb55bea101816fa226bb964ae2bed71c343b`
- 本样本假定的工具链：Node `24.18.0`，pnpm `11.7.0`
  （`package.json` 的 `packageManager: pnpm@11.7.0`，`engines.node:
  ^22.19.0 || >=24.0.0`）

`pnpm baseline:capture` 会把同一个 SHA 同时写入本文档的文件名/正文，以及
机器文件 `.dsh/baseline.json` 的 `gitSha` 字段——二者必须始终一致；
`pnpm baseline:verify` 把不一致视为 drift。

## 2. `.dsh/baseline.json` 字段参考

| field | meaning | in the hash? |
|---|---|---|
| `formatVersion` | 整数，仅在本 schema 发生结构性变更时才递增 | yes |
| `gitSha` | 被采集 checkout 的完整 40 字符 `git rev-parse HEAD` | yes |
| `toolchain.node` / `toolchain.pnpm` | 实际采集到的 `node --version` / `pnpm --version`，是一份签名元数据，必须与声明的工具链 profile（`package.json` 的 `engines`/`packageManager`）一致 | yes |
| `workspacePackages` | 每个 workspace `package.json` 的 `name` 组成的已排序数组（来自 `pnpm-workspace.yaml` 的匹配模式） | yes |
| `defaultBundleRowIds` | `packages/bundle/base/cordis.patch.yml` 中每一行 `id` 组成的已排序数组 | yes |
| `protocolSchemaHashes` | POSIX 相对路径到 SHA-256 十六进制摘要的映射，每个关键协议/事件 schema 文件一条（至少包含 `packages/sdk/protocol/src/types.ts` 与 `packages/core/session/src/known-event-types.ts`） | yes |
| `pnpmLockHash` | `pnpm-lock.yaml` 内容的 SHA-256 十六进制摘要 | yes |

构建产物（`lib/`、`dist/`）、时间戳、主机名、操作系统名，以及绝对路径或反斜杠
风格路径，均从文件和 hash 中排除：按照
`spec/first100/sources/implementation-wave-map.md` 第 57 行的 P0-01 gate 说明，
指纹只覆盖架构/协议关键面。

## 3. Canonicalization 规则

`baseline:capture` 的输出——本文档与 `.dsh/baseline.json` 一样——必须能在
Linux 与 macOS 上从同一个 commit 逐字节可复现：

- JSON key 在每个对象层级都排序（顶层与嵌套层级均如此，例如
  `protocolSchemaHashes` 的路径 key）。
- UTF-8，归一化为 NFC。
- 只使用 LF 换行，不含 `\r`。
- 所有路径都是相对仓库根目录的 POSIX 路径（`packages/…`，绝不使用 `C:\…`
  或绝对路径）——操作系统名或路径写法差异都不会泄漏进指纹。
- 不含时间戳、主机名、进程 id 或其他非确定性字段。

## 4. `pnpm baseline:verify`

在任何执行批次开始前运行。在干净的 checkout 上，它会从工作树重新推导同一组
字段，并在与上一次采集一致时退出 `0`。出现 drift 时——任何被跟踪的 schema、
bundle 行、包 manifest 或 lockfile 自采集以来发生了变化——它会以非零码退出，
指出最小化的差异（具体变化的路径，而不是笼统的 "mismatch"），并把 rebase
报告写入 `.dsh/rebase-report.json`，让运行停下来，而不是针对一个已经移动的
目标继续优化。恢复发生 drift 的文件后，`verify` 会再次通过。

## 5. Honesty — 本样本确立与未确立的事实

- **确立：** `tests/release/baseline-fingerprint.spec.ts` 用来约束未来
  `scripts/release/baseline-fingerprint.mjs` 的规范字段集、规范化规则，以及
  capture/verify 约定。
- **未确立：** `baseline:capture`/`baseline:verify` 是否存在或能运行——它们
  目前还不存在（P0-01 的 P 阶段）。截至本样本，`package.json` 中尚未注册
  `pnpm baseline:capture` 或 `pnpm baseline:verify` 脚本。contract test 中
  对 `scripts/release/baseline-fingerprint.mjs` 的真实子进程调用，目前正是
  因为这个原因而失败。
