---
description: "Epic P3-01 的 ExecutionWorld 能力 seam 词汇：一个 world 的九个约束维度、指称它的不可伪造 handle、改编自 OCI 的生命周期、typed 停止结果，以及朝拒绝方向失败的 provider 选择。"
kind: "package"
---

# @deepseek-ai/dsh-execution-world

[English](README.md) | 中文

`dsh-execution-world` 固定了在本 harness 中"一个 ExecutionWorld **是什么**"——一次请求要决定的九个维度、指称一个存活 world 的不可伪造 handle、world 所走的生命周期状态、每次停止都归一的那一个结果形状，以及"无人能满足的请求应被拒绝而不是被削弱"这条规则。它不持有 provider、不挂载服务、不 import 任何 sandbox：适配 `dsh-sandbox` 的本地 provider 是 P3-01 的 Provider 阶段，而 handle 抵达一次真实 agent 请求是它的 Usage 阶段。当你要写一个 provider、或要判定一条策略可以就"动作将从何处运行"知道什么时，阅读它。

## 目录

- [一个 world 是什么](#what-a-world-is)
- [为什么没有 `execute`](#why-there-is-no-execute)
- [handle 以及它证明了什么](#the-handle-and-what-it-proves)
- [选择朝拒绝方向失败](#selection-fails-closed)
- [Model Experience](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)

-----

<a id="what-a-world-is"></a>
## 一个 world 是什么

一份 `WorldSpec` 回答九个维度——`filesystem`、`network`、`process`、`ipc`、`devices`、`secrets`、`resources`、`lifetime`、`tenant`——且每一个都是必填。缺席的维度是一个会由 provider 用自己默认值回答的问题，而一条比较两个 world 的策略无法区分"刻意的 `none`"与"没说"。`WORLD_SPEC_DIMENSIONS` 是那份封闭清单；`missingWorldSpecDimensions` 读它而不是第二份副本，因此新增一个维度会让不完整的 spec 失败，而不是静默通过。

生命周期状态取 OCI runtime-spec 的次序（`creating` → `created` → `running` → `stopped`），**改编而非自创**：次序正是各 provider 必须一致的部分，而 container 或 microVM provider 本来就会报告它。OCI 的 `paused` 被刻意排除：本 harness 没有任何东西会挂起一个 world，而一个没有 provider 能进入的状态，就是无法被测试的词汇。`stopped` 是终态——`restore` 从快照**铸出一个新的 world**，而不是复活旧的，因此一个 `WorldId` 永不指称两种不同的约束，也就没有哪条审计记录会因指名它而变得含混。

<a id="why-there-is-no-execute"></a>
## 为什么没有 `execute`

world 不运行命令。它是命令**在其中**运行的那层约束，而本 harness 已经拥有运行东西的那些 seam——`ctx.shell`、`ctx.subprocess`、`ctx.fs`。给 `WorldProvider` 加一个 `execute`，会为每个工具造出第二条 dispatch 路径，这与 acceptance[0] 要求的"同一个 `ToolExecution` 在 provider 切换后不变"恰好相反。

<a id="the-handle-and-what-it-proves"></a>
## handle 以及它证明了什么

`WorldHandle` 以一个模块私有的 `unique symbol` 打牌记，因此模型吐出的任何对象字面量、任何从 JSON cast 来的值都无法居留这个类型（acceptance[2]）。handle **自身不携带权限**：它证明的是"该 world 由签发它的那个 provider 铸出"，而每个操作都取这个 handle，所以一个伪造对象什么也到不了。这与 Trust Kernel 给自己那些 handle 用的形状相同，理由也相同。

attestation 交给 kernel，而不在此处验证。`WorldAttestation` 是证据；kernel 已经发布了 `sandboxAttestationVerifier`，本包里再放一个验证器就会成为第二个信任根。

<a id="selection-fails-closed"></a>
## 选择朝拒绝方向失败

`selectWorldProvider` 返回第一个满足全部维度的 provider，否则返回一个拒绝——**绝不**返回最接近的 provider、不返回本地那个、也不返回把未满足维度删掉后的请求。静默降级正是 acceptance[1] 点名的那个失败，而阻止它的是返回类型本身：没有可返回的部分结果，所以调用方无法把一个被削弱的 world 误当成所请求的那个。拒绝携带每个 provider 各自未能满足的维度，因为"没有东西做得到"与"所有东西都在同一维度上失败"需要运维采取不同动作。

候选次序就是部署自己的注册次序。"越严越优先"需要一个对九个维度的全序，而本 harness 中没有任何东西定义过它；在此自创一个，会静默地把部署自己的偏好重新排序。

## Model Experience

无——本包只导出类型与纯决策，不注册任何工具、提示词文本或会话事件。

#### KV Cache effect

这里没有任何东西进入模型请求。一个被拒绝的 world 只会以其强制执行点的拒绝形式抵达模型，而那个拒绝携带一个封闭的 reason code，从不携带 spec、路径或 provider 名字。

## 已知限制与延后事项

- **这是 Contract 阶段：无法创建任何 world。** `WorldProvider` 在本仓库中没有任何实现，因此它上面的每个操作今天都不可达。读者不得把这些用例当作"任何动作已在约束中运行"的证据——现在约束命令的是 `dsh-sandbox`，同一 world 内，且不被本包改变。
- **在生产方落地前 `ExecutionWorldFact` 仍只有一个取值。** `@deepseek-ai/dsh-policy-engine` 声明 `{ kind: 'absent' }`，所以策略仍无法就"动作将从何处运行"作判断。P3-01 拥有该切分的生产方那一半（BLOCKED-178）；本包提供生产方将要据以报告的词汇，接线属同一 epic 的后续阶段。
- **`restore` 以摘要相等比较约束，因此也会拒绝更"窄"的目标。** 实现的规则是"同一约束，否则拒绝"，而不是"可收窄"；一个在 `read-only` 下取的快照会被拒绝进入 `workspace-write` 的 world，尽管那并不放宽任何东西。收紧这一点需要一个对 `WorldSpec` 的偏序，而它尚不存在；选择保守方向，是因为它阻止的那个失败——把 `full-access` 的快照恢复进一个受约束的 world——是一次静默的提权。
- **没有 provider 回报资源用量。** `WorldResourcesSpec` 陈述上限，而 `WorldOutcome` 不携带任何已消耗量，因此部署还无法对一个 world 计费或告警。结果形状就是将来添加它的地方，等某个 provider 真有数字可填。
