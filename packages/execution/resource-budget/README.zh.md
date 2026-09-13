---
description: "Epic P3-10 的资源预算词汇与记账:预算按租户、运行、动作三级限定的八个维度,对每一层外围预算的预留,准入判定,以及事先声明的计量误差上界。"
kind: "package-reference"
---

# @deepseek-ai/dsh-resource-budget

[English](README.md) | 中文

## 概述

`dsh-resource-budget` 规定本 harness 中资源预算是什么:预算所属的租户、运行、动作三级范围,它限定的八个维度(墙钟、CPU、内存、磁盘、进程、网络字节、工具调用、agent),以及把一项工作同时对它自身的预算和每一层外围预算做预留的账本(要么全部记上,要么一个都不记)。一次拒绝是一个四字段判定(`admitted`、`reason`、`limit`、`observed`),与 agent loop 的轮次预算形状相同。要限定一个租户、一次运行或一个动作能用多少资源,或者要编写日后执行这些限额的 provider 时,读这份文档。

## 目录

- [预算限定什么](#what-a-budget-bounds)
- [为什么拆分工作绕不过预算](#why-splitting-work-cannot-bypass-a-budget)
- [占用型与消耗型维度](#held-and-consumed-dimensions)
- [先声明的计量误差上界](#the-metering-error-bound-declared-first)
- [遥测名称](#telemetry-names)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="what-a-budget-bounds"></a>
## 预算限定什么

`BudgetSpec` 由一个范围和一组 `BudgetLimits` 组成。五个 world 维度原样沿用 `dsh-execution-world` 自己的字段类型:`cpuMillicores`、`memoryBytes`、`diskBytes` 来自 `WorldResourcesSpec`,`maxProcesses` 来自 `WorldProcessSpec`,`maxWallClockMs` 来自 `WorldLifetimeSpec`。因此预算与执行它的 world 用同一套词汇描述同一件事。三个运行级计数 `maxNetworkBytes`、`maxToolCalls`、`maxAgents` 在 world 中没有对应项,在这里声明。

限额为零或缺省表示不限,与 `dsh-agent-loop` 中 `LoopBudget` 的选择相同:不想让工作发生的调用方,直接不启动它。

<a id="why-splitting-work-cannot-bypass-a-budget"></a>
## 为什么拆分工作绕不过预算

`BudgetLedger.open` 只允许把账户开在范围严格更宽的父账户之下(租户、运行、动作依次变窄),并拒绝伪装成子账户的兄弟账户:运行下再开运行,或运行下开租户。`reserve` 检查该账户和每一层外围账户,预留要么记到所有这些账户上,要么一个都不记。同一次运行的子 agent 都对这次运行的账户做预留,所以五十个各允许一百次工具调用的子 agent,仍然会停在运行的一百次上限。

<a id="held-and-consumed-dimensions"></a>
## 占用型与消耗型维度

CPU、内存、磁盘和进程是**占用型**:`release` 会把它们归还,因为释放的预留腾出了它占用的资源。网络字节、工具调用和 agent 是**消耗型**:用了就不再归还,因为释放的工具调用依然是一次已经发生的调用。墙钟两者都不是:并行的工作不会叠加经过的时间,所以每次预留都直接与限额比较,而不是与累计值比较。

<a id="the-metering-error-bound-declared-first"></a>
## 先声明的计量误差上界

`METERING_ERROR_BOUND` 按维度写明 Provider 阶段计量允许的最大相对误差:墙钟、进程、工具调用和 agent 为 `0`,因为它们是计数得到或按单调时钟设定的;CPU、内存、磁盘和网络字节为 `0.1`,因为它们靠采样得到。它在任何测量之前就声明,因为测量之后才定的上界不可能出错,也就什么都证明不了。达不到这个上界的 provider 应把该维度报告为部分执行,而不是放宽这个数字。

<a id="telemetry-names"></a>
## 遥测名称

`PROCESS_SEMCONV_METRICS` 把四个维度映射到用于对账的 OpenTelemetry `process.*` 指标:`process.cpu.time`、`process.memory.usage`、`process.disk.io` 和 `process.network.io`。这些名称以字面量复制。在 `@opentelemetry/semantic-conventions` 1.43.0 中它们只存在于 `incubating` 入口,而该包的 README 要求 instrumentation 复制定义,不要在运行时 import 这个入口。有一条测试把这些字面量与钉住版本的包常量逐一比较。进程和墙钟没有对应的 `process.*` 指标(`process.thread.count` 数的是线程,`process.uptime` 是进程年龄),工具调用和 agent 也不是进程度量,所以这四个维度不做映射。

<a id="model-experience"></a>
## 模型体验

None,因为本包不注册工具、不提供提示词文本、不追加 session 事件,也不向模型描述任何预算。

#### KV Cache 影响

这里没有任何内容进入模型请求。被拒绝的预留只会通过发起它的执行点传到模型,而那个执行点不在本包中。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **目前什么都不强制执行。** 账本只记录预留,不采样任何运行中的进程,也不停止任何进程。对 CPU、内存、磁盘、进程和网络字节的硬性执行,需要一个能满足这些维度的 world provider,而今天唯一的 local provider 会拒绝所有这些维度。这项决定尚未作出,所以 fork bomb、写满磁盘、内存膨胀或网络洪泛都不受本包限制。
- **没有类型化的 `resource_exhausted` 结果。** 该结果属于 P3-03 的结果联合类型,目前还不存在。在 Provider 阶段完成映射之前,拒绝就是一个 `BudgetDecision`。
- **墙钟、工具调用和 agent 尚未接入真实运行。** 这些维度及其记账已经在这里,但还没有任何派发路径对账本做预留。
- 本包不发布运行时 invariant 伴生:账本是由唯一调用方持有的普通进程内状态,不存在会产生分歧的独立观测。
