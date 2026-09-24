# Agent Note：Run 的写入携带租约，租约存储故障时停止新工作

Status: implemented

[English](2026-09-24-run-writes-carry-the-lease-and-a-failing-lease-store-stops-new-work.md) | 中文

## 问题

P4-07 的验收因出厂 headless profile 上的两处缺口被撤回（BLOCKED-319）。其一，工作项已被接管的宿主在会话结束时仍会写 Run 的结局：`finish` 无条件调用 `endRun`，而 `RunService.advance` 不带租约，于是 `verifying` 与 `succeeded` 写在了新持有者的 Run 上。其二，会话开始时租约存储抛出异常（例如另一个连接持有 SQLite 锁超过 busy timeout），异常被监听器派发吞掉：agent 既没有 Run，也没有被拒，它的工具调用照常执行。must[1] 要求状态写携带 fencing token；用户选定由 Run 的首步写与终态写携带它，并在写入处核对，其余写入记为 Known Limitation。

## 决定

- **`RunService.advance` 接收写入方的租约。** 带上 `fence` 时，只有 `fence.mayWrite(occurredAt)` 放行才写；这一询问在该 Run 自己的顺序里、状态机判定之前进行。被拒时什么都不记，理由为 `'fenced'`，这是 `RunTransitionDenialReason` 新增的成员。询问租约本身抛出异常时，这次写入被拒为 `'lease-unavailable'`（也是新增的成员），异常不会冒出该 Run 的顺序。
- **`RunPlugin` 在五处写入上传入 agent 的租约**：`accepted → planning`、`→ running`，以及终态的 `cancelled`、`verifying` 与 `succeeded` 或 `failed`。`pauseRun` 不传。
- **因租约被拒的写入会记日志。** `RunPlugin` 的六处 Run 写入都经同一个辅助函数；它把 `fenced` 或 `lease-unavailable` 的拒绝记为一条警告，写明转移、Run 与理由。非法转移不记：`verifying` 被拒之后，终态写入仍会被请求，再被状态机按非法转移拒绝。
- **`finish` 在终态写入完成之后才交还工作项。** 先交还的话，持有者自己的写入会找不到租约而被拒。
- **`open` 把抛异常的存储当作租约被拒。** 读前任与取租约放在同一个 `try` 里；一旦抛出，agent 被标记为 `leaseRefused`，不开 Run，日志把这次拒绝记为 `lease-unavailable`。

## 考虑过的其他做法

- **在 `finish` 调用 `endRun` 之前先查 `mayWrite`**（诊断里的改动一）。未采用：那是先查、再做一次不带租约的写；delegate 只保留一套机制，即在写入处核对。
- **在 Run 上记录 epoch，由存储拒绝旧 epoch。** 用户未选：要改 Run 的 schema，属于新写。
- **让 `pauseRun` 携带租约。** 未采用：`pauseRun` 在任何 await 之前先交还租约，使干净卸载不会让工作项继续被租着；这个次序是 BLOCKED-197 的设计。

## 后果

- `pauseRun` 写 `paused`、`openForSession`、`attachSession` 与会话日志追加都不带租约。租约在 SQLite 里，Run 在它的 JSON 存储里，所以接管前一刻放行的写入仍可能落地；不声称「newer token 之后的旧写入 = 0」。
- 开始时遇到存储故障的会话，终生保持被拒，与被存活的持有者或紧急停止拒绝的会话相同；`leaseRefused` 现在也表示「存储故障」，存储恢复后需要新开会话。
- 如果租约提供方在会话的终态写入完成之前就被卸载，这些写入被拒为 `'lease-unavailable'`，交还会抛出异常，记为一次 Run 存储写入失败，租约行一直留到过期。所以宿主关停途中才结束的会话，它的 Run 可能停在非终态。
- 首步写入在 Run Service 单元层证明；出厂 profile 上的用例观测的是终态写入。
- 取得租约之后才发生的存储故障不在涵盖之内：心跳的 `renew` 抛出的异常没有被接住，在那之前工具照常派发。
