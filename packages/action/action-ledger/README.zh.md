---
description: "Epic P4-12 的外部副作用幂等账本：授权一次外部发送的预留判断、epoch 围栏，以及同键不同参数的拒绝。"
kind: "package-reference"
---

# @deepseek-ai/dsh-action-ledger

[English](README.md) | 中文

## 概述

`decideReservation` 只回答一个问题：此刻这个调用方可以发送这次外部副作用吗？它是请求与账本当前条目的纯函数，因此崩溃演练可以直接驱动它。`openLedgerStore` 让这个回答变得持久：每个 `(scope, key)` 一行 SQLite 记录，在请求离开之前写入。

## 目录

- [为什么 tool result 不是证据](#why-a-tool-result-is-not-evidence)
- [五个状态是权限，不是标签](#the-five-states-are-permissions-not-labels)
- [检查顺序](#check-order)
- [只有两边都有围栏时,预留才是排他的](#a-reservation-is-exclusive-only-when-both-sides-are-fenced)
- [换一个 call id 重试仍是同一个动作](#a-retry-under-a-new-call-id-is-the-same-action)
- [宿主用户消解 ambiguous 的副作用](#the-host-user-resolves-an-ambiguous-effect)
- [Model Experience](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)

## 为什么 tool result 不是证据

tool result 记录的是 harness 观察到的东西，它记录不了外部世界是否已提交，因为「请求发出」与「结果持久化」之间的窗口是真实存在的：在窗口内崩溃，日志就说不出那封邮件到底发没发。账本是让重试变成可判定而不是猜测的持久记录。

## 五个状态是权限，不是标签

`prepared` 表示没有任何东西离开过 harness，所以重试可以发送。`sent` 表示请求已经发出而收据没有回来，所以重试**不可以**发送。`confirmed` 与 `compensated` 都已落定——后者是因为补偿已经执行而落定，它并不释放这个键。`ambiguous` 是重试解决不了的状态，它进入对账，而不是再试一次。

## 键是按客户端划分的

一个幂等键只在客户端内部唯一，而不是全局唯一。`draft-ietf-httpapi-idempotency-key-header-07` 就是这么定义的，其安全考虑一节给出了理由：服务端若不按客户端身份划分键的作用域，一个客户端就能探知另一个客户端的键状态。因此账本的身份是 `(scope, key)`，其中 scope 是 manifest 的 `actor` principal，并且它是表主键的一半，而不是旁边多出的一列。两个 agent 从参数 hash 派生键很容易相撞；它们会得到两条各自独立的预留，谁也不会知道对方存在。

## 检查顺序

参数先于状态比较，epoch 先于两个结果检查比较。两个顺序都承重，而不是风格问题。对一个参数不同的请求回答 `duplicate`，等于告诉调用方它那条**新的、不同的**请求已经被执行过；而把结果告诉一个已被围栏挡下的代，等于把另一代现在拥有的工作的信息交出去。

<a id="a-reservation-is-exclusive-only-when-both-sides-are-fenced"></a>
## 只有两边都有围栏时,预留才是排他的

代(generation)来自一次 run 的 lease;没有 lease 的 run 递交的是 `'unfenced'`——一个状态,而不是数字零。这个区分决定了这条预留到底承诺了什么。

两边都有代时,一条 `prepared` 记录可以被**更高**的代接管,而对**同一代**则以 `held-at-same-epoch` 拒绝:更高的代意味着围栏已经证明前一个持有者出局了,而与持有者同代的调用方是一个活着的对等方,一条预留被两个持有者同时持有正是 must[2] 禁止的状态。这条拒绝与 `duplicate` 不同——后者断言副作用已经发生;也与 `stale-epoch` 不同——后者断言有后继者把这个调用方围栏挡下了。一个说「等」,另一个说「停」。

更高的代遇到一条 `sent` 记录时,以 `ambiguous-needs-reconciliation` 拒绝,`reserve` 在同一事务里按持有者的代把它改成 `ambiguous`:围栏证明发出它的持有者的租约已经失效,没有人能说清副作用是否落地(第 33 题 (a))。那个持有者可能还在运行;它之后不能确认,因为记录已是 `ambiguous`。同一代、或任一边没有代时,它仍是 `duplicate`。

只要有一边没有围栏,账本就分不清「活着的对等方」与「同一个 worker 重启」,于是它重新接管这条 `prepared` 记录,保住 at-least-once,而不是把一个谁也无法证明已被放弃的键永久搁死。此时决定里带 `fenced: false`——包括一个围栏完好的调用方去接管一条持有者本身没有代的记录:旧持有者仍然可能发送。`sent`、`confirmed` 与 `ambiguous` 不受影响:这条降级规则只重新接管从未发送过的东西,别的一概不动。

<a id="a-retry-under-a-new-call-id-is-the-same-action"></a>
## 换一个 call id 重试仍是同一个动作

键由 call id 算出，所以模型换一个 call id 重试一个结果未知的动作，带来的是一个新键。因此预留还带上自己的 capability，以及发出它那一代的租约所属的 run。同一 scope 下另一个键的记录若记着同一个 capability 与参数，并且是 `ambiguous`（不论哪个 run），或是同一个 run 里更旧的代持有的 `sent`，`reserve` 就以 `ambiguous-needs-reconciliation` 拒绝（`sameActionBlockers`，B-726）。每条这样的 `sent` 在同一事务里改成 `ambiguous`。租约的 epoch 按 run 各自计数，所以别的 run 或这一代的 `sent` 可能正在途，不挡这次预留。已结清的记录不挡，参数不同、工具不同的记录也不挡。没有带 capability 的预留只按键匹配。

`markInterrupted` 在一个事务里，把恢复的会话以中断关掉（`TOOL_OUTCOME_UNKNOWN`）的调用的 `sent` 记录改成 `ambiguous`，让它们在任何重试之前就列入对账。它不比代：恢复在修复日志之前先拿到了会话的写所有权，所以记下这个调用的持有者已经不再写那个会话；它若还在运行，之后的 `confirm` 会被拒。文件的 schema 版本是 3，更旧的文件在打开时被拒。

<a id="the-host-user-resolves-an-ambiguous-effect"></a>
## 宿主用户消解 ambiguous 的副作用

`ambiguous` 会拒绝该键后续的每一次尝试，因为重试可能执行一个也许已经提交过的副作用。这样的记录要离开这个状态，靠的是 `/resolve-effect <idempotencyKey> <confirmed|compensated>`（P4-12 acceptance[1]，BLOCKED-311）。插件在组合了命令注册表的地方注册这条命令；不带参数时，它列出正在等待的记录，不论属于哪个范围。

只有宿主用户能消解，而且能消解任何范围的记录：子 agent、workflow 子运行、webhook 会话都代表宿主用户干活，它们的记录由宿主用户对账。发起命令的 agent 必须以 `user` 主体行事，键在所有范围的 `ambiguous` 记录里查找；同一个键挂在不止一个范围下时，拒绝而不猜。宿主用户经审批界面被询问，除了批准，任何回答都不改动任何东西。获批的消解，在写下消解记录的同一个事务里，在记录自己的范围下把它移到 `confirmed` 或 `compensated`；`entry()` 会返回这份消解记录：谁消解的、消解成什么、什么时候。不带消解的迁移（`markSent`、不带消解的 `confirm`、`markAmbiguous`）只移动 `prepared` 或 `sent` 的记录，所以除了消解，没有别的途径把记录移出 `ambiguous`，也没有途径把已了结的记录移回去。记录永远不会回到 `prepared`；要重做，就是开一个带新键的新动作。`confirmed` 的消解没有 provider 回执，所以这条记录的回执摘要是这份消解记录的摘要。

## Model Experience

无,因为本包只导出一个预留决策与类型,不注册任何 model 可见的东西。

#### KV Cache effect

此处没有任何东西进入模型请求，因此不影响 provider 的缓存复用。

## 已知限制与延后事项

- **没有传输。**把 `Idempotency-Key` 传给真实 provider 这件事仍未建成:`idempotencyHeader` 命名了那个头,但没有任何 adapter 发送它,因此 must[2] 的原生透传是一个没有调用者的决策。must[3] 的另一半——查询目标状态以消解歧义——同样缺席，所以 `ambiguous` 的记录由宿主用户对账，而不是自动对账。
- **生产调用者负责预留，宿主用户负责消解。**`packages/core/agent-loop/src/tool-calls.ts` 在每次原生工具调用前预留，在工具运行前标记 `sent`，并从结果记录回执摘要或 `ambiguous`。抛错的工具会留下一条 `ambiguous` 记录，它会拒绝该键后续的每一次尝试，直到宿主用户用 `/resolve-effect` 消解它。没有命令注册表或审批界面的组合，无法消解这样的记录。
- **回执摘要算的是工具自己的内容**,也就是 harness 观察到的东西,而不是 provider 返回的东西。在传输携带真实回执之前,这个摘要证明的是"同一个结果被记录了两次",而不是"外部世界只提交了一次"。
- **`ambiguous` 分不清"不可知"与"仅仅是失败了"。**派发路径对每一个出错的工具结果都写它,这是 fail-closed 的读法:抛错的工具可能提交了,也可能没有。要区分"请求根本没发出去"与"结果确实不可知",需要本包没有的目标状态查询。
- **没有 lease 时,must[2] 不成立。**只有 Run Service 会分配 lease 代,所以不挂载它的 profile——`sdk-minimal` 出厂就不带——预留时是 unfenced 的,那里两个并发 worker 可以同时持有一条预留并且都发送。账本把这件事报成决定上的 `fenced: false`,而不是默默承诺一个它给不出的排他性;session 日志里它表现为一条没有 `leaseEpoch` 的 `action/manifest-appended` 事件。要让这些 profile 也拿到这条保证,需要它们没有的代来源。
- **没人恢复的会话，它滞留的 `sent` 记录一直留着。**那个会话恢复时它们才改成 `ambiguous`。在那之前，别的会话的重试只有在同一个 run、更新的代下才会碰到它们。
- 不发布 runtime invariant companion:本包不持有状态、也不观测任何东西,因此不存在两个观测者可能产生分歧的自有关系。

### 开发备注

<details>
<summary>给维护者的工作上下文 — 点击展开</summary>

本开发备注是给维护者的工作上下文：未决问题与尚未定下的方向。它明确不具权威性——已交付的行为与边界写在上面各节和包代码里。

账本是否还该在 provider 支持时查询目标状态、自动对账，尚未决定；目前每条 `ambiguous` 记录都由宿主用户经 `/resolve-effect` 消解。

</details>
