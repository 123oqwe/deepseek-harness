# Agent Note: 回合没记下的领取放回收件箱

Status: implemented

[English](2026-09-28-a-claim-its-turn-never-recorded-goes-back-to-the-inbox.md) | 中文

## 问题

一步在 `agent/pre-step` 瀑布之前就从 agent 收件箱领取消息，要到首次尝试才把它们写成 `user/message` 事件。回合若在这两者之间结束（pre-step 拒绝了这一步、回合被中止或出错），`turn/end` 就把这次领取记为已消费：这条消息既不在待处理里，也没有记下，它的 `(source, id, epoch)` 再投时还会被当作重复拒掉（BLOCKED-088，Epic P4-06 锁 (a)；先红 A-567）。

## 决策

- `inboxArrivals` 投影在对话把消息记为 `user/message` 时消费它的到达键，`turn/end` 释放仍被持有的每一次领取（`packages/core/agent-loop/src/inbox.ts`）。
- 回合在记录所领取的消息之前因 pre-step 拒绝或中止而结束时，在 `turn/end` 之后把这批消息放回 `next-step` 最前面，不唤醒任何东西（`packages/core/agent-loop/src/agent.ts`）。之后的唤醒把它们记下一次。
- 有意移除消息的拒绝把它们列进 `PreStepDecision.dropped`，每个监听者一条 `{ messageIds, by, reason }` 记录。这一轮的 `blocked` 结束记下这个列表，这些消息不放回。hooks 的 `UserPromptSubmit` 拒绝丢弃所领取的整批，goal round driver 丢弃自己过期或被拒的轮次，Run 插件丢弃已结束的 Run 领取的消息。
- 清空收件箱的取消，或带 `keepInbox` 又带 `cancelClaim` 的取消，会连同仍在外面的领取一起取消：这批领取先放回，再由一条 `canceled` splice 移除，这一轮的 `aborted` 结束记下取消原因。子 agent 的中断与用户的 Stop 带 `cancelClaim`：它们有意停下正要开始的工作。回合在记下领取之前出错时，也这样取消，所以一直出错的回合（例如没有模型路由的回合）不会留下待处理的输入。
- goal round driver 取消循环在中止之后放回的轮次，因为它从不再跑一次已领取的轮次。

## 已考虑的替代方案

- **只放回带到达键的消息。** 被 pre-step 拒绝的用户提示仍会不留记录地消失。
- **放回之后唤醒驱动。** 重复出现的拒绝会无限循环。
- **出错之后也放回。** 一直出错的回合（例如没有模型路由的回合）会让输入一直待处理，处在这种状态的子 agent 永远不会结算。

## 后果

- 拒绝时不带 `dropped` 的 pre-step 监听者，现在会让领取的消息保持待处理。每次都拒同一条消息的监听者会让它一直待处理，之后领取到它的每一批都会连带被拒；没有重试上限。
- 可续跑的子 agent，回合在记录所领取的消息之前结束时（监听者拒绝而不带 `dropped`），消息保持待处理。它的 Activation 只在收件箱为空时结算，所以它一直驻留，父 agent 收不到结算。
