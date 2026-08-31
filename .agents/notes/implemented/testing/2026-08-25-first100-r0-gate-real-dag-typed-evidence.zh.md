# Agent Note: First-100 R0 门 —— 真实 acyclicity、类型化证据、fail-closed 项

Status: implemented

[English](2026-08-25-first100-r0-gate-real-dag-typed-evidence.md) | 中文

## 问题

`scripts/first100/generate-specs.ts` 中的 `--r0-gate` 是一个不完整的门。它只检查四项（同波冲突、未分配 owner、待裁决 layer、未批准阈值），并且从基础注册表直接读取阈值计数而非合成裁决 overlay，因此即使未来批准阈值也无法清零。渲染的依赖图硬编码 `acyclic: true`，没有真正的拓扑排序；证据 schema 的每个键都被发射为 `type: string`——一个只能验证存在性的 schema，无法拒绝伪造的观测。一次 fixed-SHA 评审因这些原因拒绝了候选。

## 决策

`scripts/first100/generate-specs.ts` 现在计算而非假定全部三项：

- **真实 DAG 分析（`computeDag`）。** 使用字典序 frontier 的 Kahn 拓扑排序加上 DFS 回边搜索，返回 `acyclic`、一条具体的 `cycle`、`missingPredecessors` 和 `sameWavePredecessors`。依赖图工件的 `acyclic` 字段就是该计算结果。负向 spec 测试向突变注册表注入环、缺失前驱、同波前驱，并断言每种都被检测到。
- **类型化证据 schema（`evidenceProperty`）。** 每个键被约束为真实形态：`id` 是 `P[0-8]-\d{2}`，`lane` 是封闭的 4 值枚举，`baselineSha` 用 `const` 钉死到冻结基线并带 hex40 pattern，`command` 非空，`exitCode` 是整数并通过顶层 `allOf` 与 `exitSemantics` 耦合（ACCEPTED → 0，FAIL → ≥ 1，NOT_RUN/BLOCKED → null），`rawLogPath` 限定在 `.artifacts/first100/observations/` 内且无路径穿越，`rawLogSha256` 与 `signature` 是十六进制摘要（64 与 64+），`testCounts` 是 `total > 0` 的对象，`worldStateBefore/After` 拒绝 `"unobserved"`，`skipReason` 必须为空，`exitSemantics` 是封闭枚举。一个 spec 测试断言每个约束都被编码进渲染的 schema。
- **Fail-closed 的 `--r0-gate`。** `R0GateSummary` 新增 `layerSourceGap`、`agentBUncertainties`、`unsignedEnvelope` 与 `missingCommandEpics`（当前 91 个 MISSING_UNTIL_WAVE）。阈值合成 overlay（`adj.thresholds.status === 'APPROVED'` → 0）。门在所有项都已解决且 v1.1 envelope 已 SIGNED 之前以退出码 1 失败。签名是维护者对外部证据切片——R0.3A 干净分支 CI/pack、R0.3B 打包迁移账本、R0.4 runner 对 100 项的 dry 校验——完成的证明；生成器无法仅从已提交状态验证它们，因此签名 envelope 是必需接缝。manifest 中的 `remainingPending` 以同样方式合成阈值。
- **逐行 manifest 测试。** manifest 测试用 js-yaml 解析 YAML，并将每个 epic 行 `id → layerStatus → canonicalOwner → humanAssignee` 与合成的基础+裁决状态逐行比较，而非断言每个值只是出现在文件的某处。

## 曾考虑的替代方案

**保留硬编码的 `acyclic: true`。** 拒绝：断言它的测试是自我实现的。真正的拓扑排序是唯一诚实的标志来源。

**在生成器测试中用 ajv 校验渲染的 schema。** 拒绝：`ajv` 不是依赖，为测试添加依赖会波及 lockfile 与 CI。结构化测试证明约束已被编码；R0-4 的 runner 将用真实校验器验证观测是否符合 schema。

**让生成器直接验证 R0.3A/R0.3B/R0.4。** 拒绝：生成器只读取已提交的注册表与 overlay；那些外部进程无法从该状态验证。要求 SIGNED envelope 使维护者对它们的证明成为硬门。

**把 91 个 MISSING_UNTIL_WAVE 命令当作非阻塞。** 拒绝：R0 退出门的"无缺失命令"项必须保持红色，直到维护者在 R0-7 明确解决命令策略。门报告并失败。

## 后果

只要任一 R0 项未解决，`--r0-gate` 就无法自放行；证据 schema 可对伪造观测强制执行。已提交的依赖图、manifest 与阈值工件字节一致（`acyclic` 仍为 `true`，阈值仍为 17）；只有证据 schema 与生成的摘要改变。R0-4 的 runner 必须产生满足类型化 schema 的观测，并仅在退出码 0 且分离式 attestation 已验证时接受 ACCEPTED。
