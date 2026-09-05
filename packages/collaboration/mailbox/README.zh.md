---
description: "Epic P5-11 的至多一次定向投递:先解析地址再去重,并以 (id, epoch) 作为身份,使重投被识别而不是被重复应用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mailbox

[English](README.md) | 中文

## 概述

信箱把一条消息至多投递给一个收件人一次。`decideDelivery` 从收件人和调用方提供的投递历史,判断这条消息现在是否可以投递。

## 目录

- [先地址,后去重](#address-before-dedup)
- [身份是 (id, epoch)](#identity-is-id-epoch)
- [Model Experience](#model-experience)
- [已知限制与延后事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 先地址,后去重

收件人在去重检查**之前**被解析。先去重会让一条发给"无人"的消息被记为已投递,而这个错误随后不可见:发送方看到投递成功,而本该读到它的人从来没有一个可接收的地址。

## 身份是 (id, epoch)

重投携带相同的 id 和更晚的 epoch。识别这个二元组,才把"又是这条消息"和"一条恰好长得像的新消息"分开——单靠 id,在发送方重启之后就无法区分二者。

## Model Experience

None, as this package exports a delivery decision and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## 已知限制与延后事项

- **没有传输层。** 投递在这里被决策、由调用方执行;本包既不搬运字节也不持久化队列。
- **至多一次,而非恰好一次。** 调用方若在决策与自身副作用之间崩溃,消息就丢了;要挽回它需要 `dsh-message-bus` 的 outbox 模式,而不是这里。

### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

本开发备注是给维护者的工作上下文:未决问题与尚未定下的方向。它明确不具权威性——已交付的行为与边界写在上面各节和包代码里。

epoch 比较假设发送方的 epoch 跨重启单调前进。一个把 epoch 重置的发送方,会让一条真正的新消息看起来像旧消息的重投;这里没有任何东西能察觉,而修法属于 epoch 被铸造的地方,不是被比较的地方。

</details>
