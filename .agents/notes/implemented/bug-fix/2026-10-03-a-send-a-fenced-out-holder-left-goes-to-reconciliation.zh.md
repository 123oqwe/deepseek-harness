# Agent Note：被围栏挡下的持有者留下的 sent 进入对账

Status: implemented

[English](2026-10-03-a-send-a-fenced-out-holder-left-goes-to-reconciliation.md) | 中文

## 问题

原生分发在工具运行之前把外部副作用标成 `sent`。宿主在这一步之后、结果记下之前被杀，这条记录就以死进程的租约代停在 `sent`。恢复的会话重放同一个调用，以更新的代碰到同一个幂等键，账本把它当普通的 `duplicate` 回答：模型被告知这个动作「已经发出」，等于断言了一个没人知道的结果，这条记录也从没进对账（第 33 题；A-600 在出厂的 headless 启动上观测到）。

## 决定

- `decideReservation` 遇到更旧的代持有的 `sent` 记录，以 `ambiguous-needs-reconciliation` 拒绝。围栏只证明那个持有者的租约已经失效，它可能还在运行。它之后不能确认，也不能记下失败，是因为这条记录已经是 `ambiguous`，只有宿主用户的结清能让它离开这个状态。
- 账本存储的 `reserve` 在做出这个决定的同一事务里，按持有者自己的代把这条记录改成 `ambiguous`，也就是 `markAmbiguous` 做的那一步迁移。之后 `listAmbiguous` 会列出它，`/resolve-effect` 可以结清它。
- 模型拿到的是已有的对账答复：结果未知，重试解决不了，等待对账。工具不会再跑一次。
- 同一代、或任一边没有代时，`sent` 记录仍是 `duplicate`：那里可能有活着的持有者还在发送，没有能证明的租约失效。

## 考虑过的替代方案

- **`reserve` 答 `duplicate` 之后由分发调用 `markAmbiguous`。** 两次调用之间，旧持有者若还活着，可能把记录确认掉，迁移就会撞上一条已结清的记录而失败；放在一个事务里就没有这个空档。
- **为滞留的发送新加一种决定。** 已有的拒绝已经说清了调用方该怎么做，分发与它的答复都不用新增分支。

## 后果

- 崩溃之后重放同一个调用，会把结果报成未知，并把这个副作用列出来等宿主用户结清；在这个幂等键下它永远不会被执行两次。换一个 call id 重试会带来新的键，这个决定看不到；它由[同一动作检查](2026-10-03-a-retry-under-a-new-call-id-is-the-same-action.zh.md)覆盖。
- 不涵盖：没有代的 profile（没有 Run 租约）分不出持有者是死是活，那里滞留的 `sent` 记录仍按 duplicate 回答。
