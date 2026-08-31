# Agent Note: First-100 故障闭合 runner/verifier（R0-4）

Status: implemented

[English](2026-08-27-first100-fail-closed-runner-verifier.md) | 中文

## 问题

R0 资格 runner 必须重写，使维护者决策包中的 §4 利用路径不再可能。执行器可以仅凭一个非空字符串自报 ACCEPTED、在没有原始日志的情况下伪造 `testCounts`、把 `rawLogPath` 指向 observations 目录之外、把观察绑定到非冻结 baseline，或只提交单 lane 观察却聚合为 ACCEPTED。七项审计把 `testCounts` 的 passed+failed+skipped==total 约束推迟到 R0-4（finding N2），而 R0-slice-contracts.md R0-4 与决策包 §5.2 逐字要求故障闭合规则：真实 keyring + 针对钉死的可信身份的分离式 Ed25519 签名，`baselineSha` 等于冻结的 `b150a551…`，非零大小的原始日志限定在 `.artifacts/first100/observations/` 内，每个 (issue, lane) 一个 `${id}.${lane}.json`，ACCEPTED 需要全部 4 个 lane，且没有 `--commit` 覆盖。

## 决策

`scripts/first100/` 下的五个模块、一套负向测试套件，以及运行它们的接线；全部读取**已提交**的规范注册表（`tests/first100/registry.json`）与已提交的证据 schema（`spec/first100-evidence.schema.json`），绝不重新渲染：

- `scripts/first100/common.ts` — 共享类型（`Observation`、`VerdictStatus`、4 个 `LANES`）、与 cwd 无关的仓库根解析，以及注册表 / schema / 钉死身份加载器。
- `scripts/first100/attest.ts` — 规范化 JSON 序列化（排序键、剥离 signature 字段）、Ed25519 分离式签名/校验，以及身份生成：**只**把公钥钉在 `tests/first100/trusted-identity.json`，同时把私钥安装到 `~/.config/dsh-first100/first100-signing.key`（0600），或读取 `DSH_FIRST100_SIGNING_KEY`（base64 PKCS8）。私钥永不提交。
- `scripts/first100/issue-runner.ts` — `dry` 校验 100-id 目录与 lane 分类，`accepted` 恒为 0（未运行永不 PASS）；`run <id> <lane>` 真正运行命令、捕获原始日志与真实退出码、解析 `testCounts`（日志为空或不一致时拒绝伪造），并把 `${id}.${lane}.json` 写入 `.artifacts/first100/observations/`。没有 `--commit` 覆盖：`baselineSha` 永远是冻结 baseline。
- `scripts/first100/verify.ts` — 按序执行的故障闭合逐观察检查：draft-07 schema（ajv，strict；`schemaVersion` 作为注解关键字显式白名单）、针对钉死身份的分离式签名、`baselineSha`===frozen、id 在注册表中、`testCounts` 求和（passed+failed+skipped==total，total>=1——解决 N2）、空 `skipReason`、`worldState` 永不为 `"unobserved"`、`rawLogPath` 受限且非零大小并 sha256 匹配，以及从证据重新推导的 `exitSemantics`——模型/执行器自报永不构成证据。ACCEPTED 声明还要求 fixture 存在。
- `scripts/first100/report.ts` — 扫描 `${id}.${lane}.json`，拒绝内容 id/lane 与文件名不匹配的文件，并按 issue 聚合：任何 REJECTED 证据都使该 issue 失效，ACCEPTED 需要全部 4 个 lane，真实的 FAIL 或 BLOCKED 如实呈现，部分覆盖为 NOT_RUN——绝不 ACCEPTED。它写出带签名的 `verdicts.json`。
- `tests/first100/first100.spec.ts` — 30 个测试，用聚焦负向用例证明每条 §5.2 拒绝规则（伪造/错键/未签名、未知 baseline、伪造计数、非空 skipReason、`"unobserved"` 世界、路径穿越 `rawLogPath`、空/缺失/sha256 不匹配的原始日志、exitSemantics 矛盾、缺失 fixture、单 lane 非 ACCEPTED、文件名/内容不匹配），外加正向回环：真实观测的运行通过签名，且一个 issue 只有全部 4 个 lane 都带签名才聚合为 ACCEPTED。
- 接线 — `ajv` 作为根 devDependency、`first100:*` package scripts、vitest `testIncludes` 中的 `tests/**/*.spec.ts`，以及 `.oxlintrc.json` 中的 tests override。

## 备选方案

**放宽 ajv strict 模式（`strictSchema: false`）。** 拒绝：strict 模式正是「拒绝无法完全理解的 schema」这一故障闭合属性。唯一非标准关键字是 `schemaVersion` 元数据字段，因此显式白名单它，其余未知关键字仍然抛错。

**当证据内部自洽时信任自报的 `exitSemantics`。** 拒绝：§5.2 的全部意义在于 verifier 从原始证据重新推导语义。schema 把 `exitSemantics` 与 `exitCode` 耦合（ACCEPTED->0，FAIL->>=1，NOT_RUN/BLOCKED->null），`verify.ts` 交叉核对推导，因此矛盾（exit 0 却有失败测试，或证据暗示 NOT_RUN 却声明 BLOCKED）被拒绝。

**只要有任一 lane 被证明就把 issue 标为 ACCEPTED。** 拒绝：R0-slice-contracts 要求全部 4 个 lane。聚合故障闭合——部分覆盖为 NOT_RUN，单个 REJECTED lane 就使 issue 失效。

## 后果

`pnpm run test` 现在也发现 `tests/**/*.spec.ts`，因此负向套件与 R0-3 检查器一起在 CI 运行。`pnpm run first100:dry` 校验目录（exit 0），`pnpm run first100:verify` 写出带签名的 `verdicts.json`，把未运行的 issue 报告为 NOT_RUN——绝不 PASS。R0-4 slice 与 R0-6 负向控制在当前 SHA 为绿；R0-2 评审中的 finding N2 已解决（`testCounts` 求和检查在 `verify.ts` 中强制，并由伪造计数负向用例证明）。

First-100 仍为 0/100 ACCEPTED，阈值仍为 PROPOSED_PENDING_MAINTAINER，v1.1 envelope 仍为 UNSIGNED，W1 仍为 BLOCKED：R0 exit gate 仍诚实地失败（R0.3A 干净基线 CI/pack、R0.3B 打包迁移 ledger，以及 R0-7 维护者批准 + 签名 envelope 仍未完成）。本 slice 没有任何自批准。
