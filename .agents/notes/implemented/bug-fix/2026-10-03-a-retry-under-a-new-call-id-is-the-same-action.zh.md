# Agent Note：换一个 call id 重试仍是同一个动作

Status: implemented

[English](2026-10-03-a-retry-under-a-new-call-id-is-the-same-action.md) | 中文

## 问题

幂等键由会话、call id 与参数哈希算出。崩溃之后，恢复用 `TOOL_OUTCOME_UNKNOWN` 关掉被打断的调用，这个调用的账本记录以死进程的代停在 `sent`。模型换一个 call id 重试这个动作，就带来一个新键：账本给它预约，工具又跑了一次；滞留的那条 `sent` 也一直没进对账清单（B-726；P4-12 acceptance[1]）。

## 决定

- 恢复时，在追加关闭事件之前，`settleInterruptedEffects` 把每个以 `TOOL_OUTCOME_UNKNOWN` 关掉的调用的 `sent` 记录在一个事务里改成 `ambiguous`（`markInterrupted`）。`run_code` 调用的记录包括它的 code-mode 子调用，子调用的 action id 是 `<callId>:ptc:<n>`。这里不比代。恢复在修复日志之前先拿到了会话的写所有权，所以记下这个调用的持有者已经不再写这个会话。那个持有者若还在运行，它之后的 `confirm` 会被拒，因为记录已是 `ambiguous`，不会重复发送。没有代的记录也一样改。
- 预约带上自己的 capability，以及发出它那一代的租约所属的 run。同一 scope 下另一个键的记录若记着同一个 capability 与参数，并且是 `ambiguous`（不论哪个 run），或是同一个 run 里更旧的代持有的 `sent`，`reserve` 就以 `ambiguous-needs-reconciliation` 拒绝（`sameActionBlockers`）。每条这样的 `sent` 在同一事务里改成 `ambiguous`。已结清的记录不挡，参数不同、工具不同的记录不挡，这一代或别的 run 的 `sent` 也不挡。
- 租约的 epoch 按 run 各自计数，所以只有同一个 run 的两代才可比。账本把这个 run 记在 epoch 旁边。
- 账本文件的 schema 版本是 3，新增 `capability` 与 `lease_run` 两列，以及 scope、capability、参数哈希上的索引。按发布前惯例，版本 2 的文件在打开时被拒。
- 对账答复加了一句：由宿主用户用 `/resolve-effect` 结清，不要换一个调用再做一次。

## 考虑过的替代方案

- **按内容算键，去掉 call id。** 有意的相同重复就会永远被当成 duplicate，改变了一个已验收 epic 依赖的键语义。
- **只靠答复文字。** 原来的文字已经叫模型不要盲目重试，模型照样重试了，副作用就发了两次。
- **恢复时拿滞留记录的代与恢复后 run 的代比。** Run Service 在它自己的 `agent/session-start` 监听里挂上新的代，没有东西保证这个监听排在别的插件之前。修复日志的那一处能拿到的证据，是会话的写所有权。
- **跨 run 比代。** 每个 run 的 epoch 都从零数起，别的 run 里正在途的 `sent` 可能读成更旧，被当着它的持有者改成 `ambiguous`。

## 后果

- 崩溃之后，会话一恢复，被打断调用的副作用就在对账清单里。在恢复的会话里，同一工具、同一参数的重试，不论带什么 call id，都会被拒，直到宿主用户结清。
- 前一次还没结清时，有意重复同一动作也会被拒，答复里写明 `/resolve-effect`。
- 不涵盖：从不恢复的会话，它的 `sent` 记录一直留到恢复。在那之前，别的会话的重试只有在同一个 run、更新的代下才会碰到它们。没有带 capability 的预约只按键匹配；出厂的两条分发路径都带。
