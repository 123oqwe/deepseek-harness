# Agent Note：崩溃修复把被中断的一轮里没有得到答复的审批判为 cancelled

Status: implemented

[English](2026-09-26-an-unanswered-approval-is-cancelled-by-crash-repair.md) | 中文

## 问题

P2-07 acceptance[0] 的第一个崩溃点：审批请求在等答复时，宿主被杀掉。日志里留着 `approval/asked`，崩溃修复也关上了被中断的那一轮和那次工具调用，但没有任何东西为这次询问作出判定。重启之后，这条审批既没有在记录上被判定，也没有被重新提出。lane A 的 A-474 第二部分在出厂 headless profile 上量到了这一点（run 36215977489）。

## 决定

- **由恢复时的修复为没有得到答复的询问作出判定。** agent 层的语义崩溃修复，为被中断的最后一轮里问过却没有得到答复的每个审批补一条 `approval/decided { outcome: 'cancelled' }`，这正是被中止的请求所得的结局。答复方、在等的调用及其信号都随宿主一起消失了，之后的任何生命周期都无法再答复它。
- **在这一轮之内。** 判定放在工具结果的闭合事件之后、合成的 step 与 turn 结尾之前，因为 user-approval 的不变式只接受处在未结束轮次内的审批事件对。其后的闭合事件的 seq 顺延，保持连续。
- **放在哪里。** `@deepseek-ai/dsh-agent-loop` 里的 `closeUnansweredApprovals` 作用在 `interruptedTurnClosers` 的返回值上，位于本来就读取已存储日志的恢复路径。

## 考虑过的替代方案

- **放进 `interruptedTurnClosers`（core session）。** 只读的冷读也能照同样的方式配平，但审批事件属于 `@deepseek-ai/dsh-user-approval`，core session 并不依赖它。
- **由 user-approval 在会话开始时，以 `session/end-seed` 边界为准，关掉自己的失效询问。** 新代码不许再同步读 Session 历史，要找出没有答复的询问就得用 projection，再加两个依赖；而且判定会落在任何轮次之外，不变式不接受。
- **重新提出。** 询问所属的那次调用已随它的轮次结束；重新提出就要重跑一个被中断的轮次，而恢复从来不这样做。

## 后果

- 审批等待期间发生崩溃之后，恢复出的日志把这条审批记为 `cancelled`，把它拦下的那次调用记为未开始或结果未知。
- 只读观察方（session-query）配平冷的中断日志时不带这些判定；会话被恢复之后，判定才出现。
- 这是 P2-07 的第一片。带各个状态、持久化的 digest 与截止时间、compare-and-swap 消费与 scheduler 唤醒的审批存储（must[0] 到 must[4]），以及批准之后、消费之前的崩溃，属于之后的切片。
- 验证：A-474 第二部分（`tests/first100/fixtures/P2-07.approval-crash.composition.spec.ts`）与 `packages/core/agent-loop/tests/approval-repair.spec.ts`。
