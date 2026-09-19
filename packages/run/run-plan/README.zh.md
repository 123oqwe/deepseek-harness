---
description: "Epic P4-03 的 RunPlan 词汇:一次运行所执行的、编译出来的纯数据计划。它照 spec/run-plan.schema.json 逐字写成,引用仓库已有的目标、约束、模型、世界、预算、审批与验证类型,只为仓库确实没有的三样新铸词汇。"
kind: "package-library"
---

# @deepseek-ai/dsh-run-plan

[English](README.md) | 中文

## 概述

`dsh-run-plan` 持有 Epic P4-03 的 must[0] 所钉死的那套词汇:一个计划的 objective、约束、模型路由、上下文拓扑、agent 图、世界绑定、预算、审批闸口、验证条目与恢复规则,连同读者首先要核的 ABI 版本,以及计划被命名所用的内容寻址 `PlanId`。

`src/types.ts` 是 `spec/run-plan.schema.json` 的 TypeScript 面:同样的字段名、同样的必填成员,所以在一边通过校验的计划,在另一边读起来是同一个东西。把输入编译成计划——或者编译成「不可能同时成立」的那组最小约束——的那次编译落在 `src/compile.ts`;让计划真正被执行的挂载属于本 epic 更后面的阶段。

## 目录

- [本包引入而非声明的东西](#what-this-package-imports-rather-than-declares)
- [刻意缺席的东西](#what-is-deliberately-absent)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="what-this-package-imports-rather-than-declares"></a>
## 本包引入而非声明的东西

must[0] 点名的十个字段里有七个,仓库已经有现成词汇,本包**逐个引入**。

`RunPlanObjective.goalRef` 与 `RunPlanConstraint.provenance` 就是 `@deepseek-ai/dsh-task-profile` 的 `TaskGoalRef` 与 `InferenceProvenance`,`RunPlanConstraint.strength` 就是该包的 `TaskConstraintStrength`。由任务画像编译出的计划与画像本身,必须对「某个决定来自哪条目标消息」说同一句话;同一个引用若被声明两遍,它们可以互相矛盾而无人察觉。

`AgentNode.taskProfileRef` 是 `TaskProfileRef`,`WorldBinding.spec` 是 `WorldSpecDigest`,`RunPlanBudget.dimension` 是 `BudgetDimension`——即 `BudgetAmounts` 已经命名的那八个维度。`ApprovalGate.approvalRef` 与 `VerificationEntry.verificationRef` 是 Run 自己的 `ApprovalRef` 与 `VerificationRef`。`RunPlanModelRoute.selection` 是 agent 层的 `ModelSelection`。

有三个字段此前没有任何现成词汇,在此首次定义:`contextTopology`,它说明哪个节点可以读另一个节点产出的什么、能留多久;`agentGraph`,即节点与它们被允许的执行次序;以及 `recovery`,即某个节点失败时会发生什么。三者都是数据——一条有向通道、一条带理由的边、一条动作有界的规则——不携带任何可执行的东西。

本包唯一铸造的身份是 `PlanId`,其形成方式与 `TaskProfileRef`、`WorldSpecDigest` 相同:计划归一化输入的 sha256 小写十六进制,**绝不由调用方选定**。

<a id="what-is-deliberately-absent"></a>
## 刻意缺席的东西

**没有可执行的叶子。** must[2] 靠构造成立,而不是靠一道检查:`RunPlan` 的每个叶子都是字符串、数字或某个封闭联合的成员,所以计划没有任何字段可以装下表达式、脚本或待执行的模块路径。在这个文件里开一个 `Record<string, unknown>` 的口子,就等于把这个洞重新打开。

**不用可选字段来表示「尚未决定」。** `RunPlan` 的每个成员都是必填。可选字段会被所有生产者省略,而那与「计划对它什么都没决定」无法区分——acceptance[1] 的可追溯性正依赖于区分这两者。`AgentNode.worldId` 与 `AgentNode.budgetIds` 是两个例外,它们各自有确切含义:采用运行的默认世界;以及除运行级上限外没有节点级上限。

**没有「缺了自己所需之物」的恢复规则。** `RecoveryRule` 是按 action 判别的联合,而不是一个带可选成员的形状,所以「retry 却没有尝试上限」「substitute 却没有替代节点」根本写不出来,而不只是校验不过。

**运行时不变量:** No runtime invariant companion is published: 本包声明的是类型,以及从下一阶段起的一次纯编译,其输入由调用方组装。它不拥有任何注册表、日志或 `Context` 值,也就没有任何「两个独立观测之间的关系」可供检查器比对。

<a id="model-experience"></a>
## 模型体验

无。本包不注册任何 prompt、schema 或工具,编译出的计划也到不了任何模型请求:目前没有任何 profile 挂载它,而会把计划内容放进请求的那个读者属于本 epic 更后面的阶段。

#### KV Cache 影响

无;这里没有任何东西组装或参与 provider 请求,因此没有前缀发生移动,也没有已缓存前缀被作废。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **还没有编译。** 本阶段钉的是词汇。`compilePlan` 与 `planIdOf` 落在 `src/compile.ts`;在那之前没有任何东西产出 `RunPlan`——这些类型描述的是一个仓库里还没有代码去构造的形状。
- **还没有挂载。** 没有任何 profile 为本包写下一行。一个没人编译、也没人执行的计划,是一份等着它后续阶段的契约——这正是 C 阶段的含义。
- **`schemaVersion` 还没有读者。** 这个字段的存在是为了让 must[4] 的承诺能被兑现——不认识的版本被拒绝,而不是被误读——但那次拒绝属于编译,不属于类型。

### 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文:待解问题与尚未定下的方向。它明确不具权威性——已发布的行为与限制写在上面的章节与包代码里。

待解问题之一是「归一化输入」究竟指什么,因为 `PlanId` 的稳定性正是对着它度量的。对一个顺序不承载含义的数组重排,不应改变 id;而对 `agentGraph.edges` 重排同样不应改变 id,理由却不同——顺序在那里不承载含义,它所描述的图却承载。哪些数组是集合、哪些是序列,是编译必须显式做出的决定;把它写在那里而不是写在这里是刻意的:类型表达不了它。

待解问题之二是冲突集该看多远。acceptance[0] 要的是 hard 约束上的最小集合,而「最小」是可测的——去掉任一成员,其余即可满足。至于「约束与预算之间的冲突」「约束与某节点所需世界之间的冲突」是否与「约束与约束之间的冲突」同属一个集合,这条 clause 并未裁定。

</details>
