---
description: "Epic P4-06 唯一的 (source, message id, epoch) 去重规则：键推导与 seen 集判断，由消息总线与信箱共同应用，各自保留自己的前置检查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-intake-dedup

[English](README.md) | 中文

## 概述

`classifyDedup` 根据消息的 `(source, id, epoch)` 身份和消费者已应用过的键集合，判断一次到达是首次到达还是重复到达。`dedupKey` 推导该键。此处再无其他内容。

## 目录

- [为什么单独成包](#why-a-package)
- [身份是这个三元组](#identity-is-the-triple)
- [前置检查留在调用方](#the-precedence-check-stays-with-the-caller)
- [Model Experience](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 为什么单独成包

`dsh-message-bus` 与 `dsh-mailbox` 各自写过一遍这条规则，键推导相同、调用方提供 seen 集的方式相同、顺序也相同——后者在注释里引用前者，而不是 import 它（BLOCKED-136）。一条规则有两份实现就会漂移，而 P4-06 子句所指的那一份，正是没有任何调用者的那份。

它独立成包而不是作为任一调用方的导出，原因是分层方向：`collaboration` 属于 capability-definitions，`run` 属于 orchestration-runtime，因此信箱 import 总线就是定义依赖运行时。放在这里，两条边都向下或同层。

## 身份是这个三元组

一条消息 id 只在它的发送方内部唯一，所以 `source` 是身份的一部分：CloudEvents 也是这么定义的，而 BLOCKED-140 记录了本包忽略它期间发生的事——两个发送方各发 `('evt-1', 1)` 产生同一个键，第二条被当作第一条的重复丢弃，而且是静默的，因为丢弃正是去重工作时的样子。

在同一个发送方内部，重投递携带相同的 id；发送方重启后重用计数器，同样携带相同的 id，而那条消息的效果并未发生。epoch 把这两者区分开。

source 与 id **都**带长度前缀——`${source.length}:${source}:${id.length}:${id}:${epoch}`——因此两者内部无论怎样安排分隔符，都拼不出另一个三元组的键。没有前缀时，`('a:1', 2)` 与 `('a', '1:2')` 产生同一个键，消费其中任意一条都会静默压制另一条。BLOCKED-138 记录了一个丢掉前缀的持久存储，撞上的正是这一点。

## 前置检查留在调用方

本模块不知道谁有权接收一条消息。总线拒绝外部租户，信箱拒绝寄往他处的消息；两者都在本规则之前运行自己的检查。若用一条消费者无权处理的消息推导出的键去查 seen 集，会让该消息压制后续一条共享同键的合法消息，并暴露该键是否在此处出现过。

“有权处理”的含义在两者之间并不相同。去重规则则相同，所以只有规则住在这里。

## Model Experience

None, as this package exports a duplicate decision and types only and registers nothing model-facing.

#### KV Cache effect

此处没有任何东西进入模型请求，因此不影响 provider 的缓存复用。

## 已知限制与延后事项

- **seen 集由调用方提供。** 本模块不持有状态，也不对该集合的来源作任何假定；`dsh-message-bus` 的 `bus.sqlite` 提供了一个持久的版本，而自行组装集合的调用方，得到的持久性就是它自己构建出的那一份。
- 不发布 runtime invariant companion（No runtime invariant companion is published）：本包不持有状态、也不观测任何东西，因此不存在两个观测者可能产生分歧的自有关系。它的判断是参数的纯函数，由应用它的两个包中的单元用例覆盖。

### 开发备注

<details>
<summary>给维护者的工作上下文 — 点击展开</summary>

本开发备注是给维护者的工作上下文：未决问题与尚未定下的方向。它明确不具权威性——已交付的行为与边界写在上面各节和包代码里。

在本包出现之前，这条规则存在三份实现，而第三份是把持久的那份接到另外两份上时才被发现的（BLOCKED-138）。没有任何东西能阻止第四份：一个不 import `dedupKey` 而自行推导键的消费者，能编译、能通过自己的测试，并静默地与其他实现不一致。这该由 lint 规则、seam 处的运行时断言，还是什么都不做来处理，尚未决定。

</details>
