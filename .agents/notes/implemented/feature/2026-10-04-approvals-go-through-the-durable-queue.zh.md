# Agent Note：审批经由持久队列

Status: implemented

[English](2026-10-04-approvals-go-through-the-durable-queue.md) | 中文

## 问题

Epic P2-07 的 acceptance[1] 与 acceptance[2] 要求一项审批至多运行一次它的动作，过期或被撤销之后都不再运行，并由比较并交换来判定。契约切片之后，`@deepseek-ai/dsh-user-approval` 仍在原地决定，不向 `ctx.approvalStore` 写任何东西，也没有任何分派路径读它，所以被其他客户端撤销的授权仍会运行。

## 决定

- **审批服务记录每一次询问。** 挂载了 `ctx.approvalStore` 时，`request()` 在 `approval/asked` 之前记录一条轮次作用域的审批，并把结果记为它的状态迁移：`allowed-once` 批准它，`rejected` 拒绝它，`cancelled` 与 `unavailable` 撤销它。存储拒绝的迁移保持存储中的原样；动作能否运行由消耗决定。
- **租户与执行者取自会话的 manifest 归属。** `approvalViewerOf(session)` 就是 `manifestAttribution(attachedIdentity(session), session.id).actor`，因此一项审批与它所覆盖动作的 manifest 指名同一租户与主体（delegate 的裁定，2026-10-04）。
- **由分派来消耗。** agent loop 的原生调用、code-mode 子分派与公开接缝的直接调用，都在 `verifyRecordedApproval` 之后、`reserveExternalEffect` 之前（直接调用不做预留）消耗其 `approval/bound` 记录指名的审批。核验与消耗经由同一个函数选出这条记录。消耗失败时，调用以 `ApprovalConsumedError` 拒绝，代码为 `ABORTED_BEFORE_DISPATCH`。
- **找不到审批时以拒绝方式关闭。** 挂载了存储时，存储中没有该会话租户名下这项审批的分派以 `not-found` 被拒绝。
- **未绑定的询问在决定时即被消耗。** 没有绑定的询问（例如工作区信任）没有会读回它的分派，所以由 `request()` 消耗它的授权；此时无法消耗的授权在追加 `approval/decided` 之前以 `cancelled` 结算。
- **发布 agent 时撤销崩溃轮次的审批。** 审批服务中的一个 `agent/created` 监听器撤销该会话各轮次留下的、处于 requested 或 approved 状态的轮次审批，因此 `agent-loop` 不变。

## 考虑过的替代方案

- **存储中没有审批时让分派运行。** 存储挂载之前询问的审批会继续有效，被租户不匹配隐藏的审批也会；以拒绝方式关闭的代价只是再问一次。
- **在 agent loop 的恢复修复中撤销。** 那会改动 `agent-loop`；监听器从拥有这些询问的服务出发，覆盖每一次 agent 发布。

## 后果

- 基于 `dsh-base` 的每个 profile 都在 `dshHomePath('approvals')` 挂载 SQLite 存储，共用同一个 home 的宿主共用同一个队列。Run 的 `waiting_for_approval` 在 Use 切片后续的一次提交中跟进。
- 撤销会在为会话创建的每个 agent 上运行，包括新会话，那时没有可撤销的审批。
