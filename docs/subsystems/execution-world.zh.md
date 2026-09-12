---
description: "ExecutionWorld 子系统：一个 world 在九个约束维度上是什么、指称它的不可伪造 handle、改编自 OCI 的生命周期、归一的 typed 停止结果，以及为什么选择是拒绝而不是降级。"
kind: "subsystem"
---

# ExecutionWorld 子系统

[English](execution-world.md) | 中文

ExecutionWorld seam 只回答一个问题——**这个动作将在何处运行、在什么约束之下**——并把这个答案与"动作**是什么**"分开。Epic P3-01 拥有它。本页描述的是契约；尚无任何 provider 实现它。

## 它是什么，以及它替换了什么

已有四个包在散文里指名 ExecutionWorld，而没有一个实现它。`@deepseek-ai/dsh-policy-engine` 自 P2-05 起一直携带 `ExecutionWorldFact = { kind: 'absent' }`——一个单取值类型；`policy-engine-cedar` 把 `world: request.world.kind` 传入 Cedar 上下文；`capability-token` 把 ExecutionWorld 点名为令牌必须被出示的四个边界之一；`subagent` 则记下了一条"在 world 被设计出来之前不塑形钩子"的决定。所以本子系统**替换的是一个占位符，而不是引入一个概念**。

那个单取值的事实，也正是某条验收条款此前不可证的原因：当除 `absent` 之外没有第二个值可供拒绝时，策略无法就一个 world 朝拒绝方向失败。

## 九个维度

一份 `WorldSpec` 回答 `filesystem`、`network`、`process`、`ipc`、`devices`、`secrets`、`resources`、`lifetime` 与 `tenant`。九个全部必填。缺席的维度是一个会由 provider 用自己默认值回答的问题，而一条比较两个 world 的策略无法区分"刻意的 `none`"与"没说"。该清单以封闭常量导出，每个完整性检查都读它，因此新增维度会让不完整的 spec 失败，而不是静默通过。

## 生命周期

`creating` → `created` → `running` → `stopped`，改编自 OCI runtime-spec 的状态词汇：次序正是各 provider 必须一致的部分，而 container 或 microVM provider 本来就会报告它。OCI 的 `paused` 缺席：本 harness 没有任何东西挂起 world，而一个无法进入的状态就是无法被测试的词汇。

`stopped` 是终态。`restore` 从快照铸出一个**新的** world 而非复活旧的，因此一个 `WorldId` 永不指称两种约束，也没有哪条审计记录会因指名它而含混。

每次停止都归一到同一个 `WorldOutcome` 形状，无论是什么停止了它——`completed`、`terminated`、`timeout`、`lost-contact`、`provider-failed`。五种原因同一形状正是那条要求：调用方不得能够处理一个被杀掉的 world、却在一个失联的 world 上漏过去。

## 为什么 provider 没有 `execute`

world 是命令在其中运行的那层约束，不是运行命令的东西。`ctx.shell`、`ctx.subprocess` 与 `ctx.fs` 已经在运行东西。在 provider 上加 `execute` 会为每个工具造出第二条 dispatch 路径，与"同一个 `ToolExecution` 在 provider 切换后不变"这条要求恰好相反。

同一条要求也是 world **不属于** `ActionManifest` 的原因。一份指名了 world 的 manifest，会让同一个动作在两处运行得到不同的规范形式、不同摘要与不同批准，于是切换 provider 就会使据其做出的每一次绑定失效。`@deepseek-ai/dsh-tools/types` 中的 `ToolWorldBinding` 把 world 记在 dispatch **旁边**，供审计使用。

## handle，以及信任住在哪里

`WorldHandle` 以模块私有的 `unique symbol` 打牌记：模型吐出的任何对象字面量、任何从 JSON cast 来的值都无法居留这个类型。handle 自身不携带权限——它证明的是该 world 由签发它的 provider 铸出，而每个操作都取它，所以伪造对象什么也到不了。

attestation 交给 Trust Kernel，它已经发布了 `sandboxAttestationVerifier`。本子系统里再放一个验证器就会成为第二个信任根。

## 选择是拒绝，而不是降级

`selectWorldProvider` 返回第一个满足全部维度的 provider，否则返回一个携带各 provider 未满足维度的拒绝。它绝不返回最接近的 provider、本地那个，或删掉未满足维度后的请求。阻止降级的是返回类型：没有部分结果，因此调用方无法把被削弱的 world 误当成所请求的那个。

候选次序是部署自己的注册次序。"越严越优先"需要一个对九个维度的全序，而这里没有任何东西定义过它。

## 尚未抵达的部分

- **不存在任何 provider。** `WorldProvider` 上的每个操作在本仓库中都不可达。今天约束命令的是 `dsh-sandbox`，同一 world 内，且不被本契约改变——它自己的 README 早已划出这条界：container、microVM 与远程执行器是**整体替换能力**，而不是在那里注册。
- **`ExecutionWorldFact` 仍只有一个取值。** 策略词汇在生产方落地前保持 `{ kind: 'absent' }`，所以还没有策略能就一个 world 作判断。P3-01 拥有生产方那一半（BLOCKED-178）。
- **`restore` 以摘要相等比较约束。** 因此它也会拒绝更窄的目标，而不只是更宽的。选择保守方向，是因为它阻止的失败——把 `full-access` 快照恢复进受约束的 world——是一次静默提权；放松它需要一个尚不存在的 `WorldSpec` 偏序。
- **没有用量回报。** 上限被陈述了，而没有任何东西回报一个 world 消耗了什么，所以部署还无法对它计费或告警。
