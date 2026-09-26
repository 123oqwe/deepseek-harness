# Agent Note：action manifest 记录风险门的判定

Status: implemented

[English](2026-09-26-the-manifest-records-the-risk-gates-verdict.md) | 中文

## 问题

BLOCKED-315，P2-03 acceptance[2]：manifest 与风险门对同一个动作各分类一次，结论不同。每条派发路径都经 `classifySideEffect(undefined)` 构造 manifest，所以每次调用都记成 `destructive`、`classified: false`、`requiresApproval: true`；风险门却按组织策略里针对工具声明的领域标签的规则给同一次调用分类，在出厂 preset 下放行一次 `read` 调用而不询问。lane A 的 A-443 在出厂 headless profile 上量到：风险门分类为 `read` 的探针，在原生路径与 code-mode 路径上都被记成 `destructive`、未分类、需要审批。

## 决定

- **一张表，放在 `@deepseek-ai/dsh-risk-taxonomy`。** `SIDE_EFFECT_CLASS_BY_RISK` 把每个风险类映射到 manifest 记录的类：`read` 映射到 `read`；`local-reversible` 与 `internal-write` 映射到 `write`；`external-communication` 映射到 `network`；`destructive`、`financial`、`security-sensitive` 与 `safety-critical` 映射到 `destructive`。这张表是全映射且单调的，没有哪个风险类产生 `process`。delegate 在 2026-09-26 批准了这张表。
- **每个动作只有一个判定。** `judgeActionRisk`（`@deepseek-ai/dsh-tools/external-effect`）一次取得分类、生效的 preset 与这个 preset 的审批决定。原生、code-mode 与直接调用三条路径经 `manifestClassificationOf` 把它记进 manifest，再交给 `gateActionRisk`，风险门不再自己另判一次。
- **`classified` 取决于类是怎么得出的。** 由策略规则决定的类，或内核拒绝带，按表记录并标 `classified: true`；未知默认记成 `destructive`，标 `classified: false`。
- **`requiresApproval` 是 preset 的决定。** 被硬拒的动作记 `false`：风险门不询问就拒绝它，由 `action/risk-gated` 记录这次拒绝。

## 考虑过的替代方案

- **让 manifest 不看 preset，只由风险门决定。** 那样日志会写某个动作需要审批，风险门却从没问过，或者相反；delegate 裁定 manifest 记录风险门的实际决定。
- **把领域标签直接映射到 manifest 的类。** 标签只是风险分类的输入，从标签另做一次映射，结论可能与风险类不一致。
- **把表放在 `ActionSideEffectClass` 旁边。** 那样风险门要读 manifest 包拥有的表；放在双方都读的那个包里，来源只有一个。

## 后果

- 有分类的调用，manifest 的类改按这张表记录。出厂的 `bash` 调用，`shell-execute` 被分类为 `internal-write`，记成 `write` 而不是 `destructive`。出厂策略集按 `riskClass` 判定，唯一的硬拒是内核拒绝带，所以没有哪条出厂策略因此放宽。部署方的自定义策略如果按 `sideEffectClass` 判，应改按 `riskClass` 判。
- 在 `danger-full-access` 下，其阈值高于未知默认，无法分类的动作不询问，其 manifest 记 `classified: false` 与 `requiresApproval: false`。在出厂默认 preset 下它仍需要审批。
- 录制会话快照里，会话调用了声明领域标签的工具的，会记录映射后的类，需要刷新。
- 验证：A-443（`tests/first100/fixtures/P2-03.manifest-class.composition.spec.ts`）的两条路径，以及 `packages/policy/risk-taxonomy/tests/side-effect-class.spec.ts`。
