# Agent Note：会话都已不在的恢复 Run 会失败，而不是一直挂着

Status: implemented

[English](2026-09-27-a-restored-run-whose-sessions-are-gone-fails.md) | 中文

## 问题

P4-05 acceptance[2] 要求孤儿 Run 在重启后被接管，或者安全地失败。崩溃若落在 Run 已落盘、会话还没落盘之间，留下的 Run 没有任何宿主能继续：接管发生在会话启动时，而那个会话再也不会启动。这样的 Run 永远停在非终态（A-560）。状态机也没有办法让 `accepted` 或 `paused` 的 Run 失败。

## 决策

- `LEGAL_RUN_TRANSITIONS` 允许 `accepted` 与 `paused` 转到 `failed`。P4-01 列出状态集合，并要求拒绝非法转换；哪些转换合法是设计选择，状态集合不变。
- 挂载时，一旦 session persistence 可用，run 插件逐个检查挂载时恢复的非终态 Run。它的会话都不存在时（`SessionPersistence.stat` 返回 `undefined`），插件像接管那样先拿这个 Run 的租约，在这份租约下把 Run 推到 `failed`，再释放租约。租约仍被活着的持有者占着时，它的 Run 不动。
- 原因写进日志行。Run 的日志没有放原因的字段；加上它要改 `runs.json` 的格式。

## 已考虑的替代方案

- **把 `accepted` 或 `paused` 的 Run 取消。** 不改转换表也合法，但 `cancelled` 的意思是有人取消了它。
- **让 `accepted` 先经 `planning` 再到 `failed`。** 这会记下一次从未发生的 planning。

## 后果

- 在崩溃中丢了全部会话的 Run，下次启动时会到达 `failed`，不再永远留在 `listNonTerminal` 里。
- 失败原因不落盘；把它记进 Run 的日志已登记为后续工作。
- 验证：A-560（`tests/first100/fixtures/P4-05.reclaim-after-restart.composition.spec.ts`），lane A 的 A-562 取代 P4-01 表格里标题会变的两条。
