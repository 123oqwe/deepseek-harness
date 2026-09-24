# Agent Note：工具派发途中请求审批，是在等人

Status: implemented

[English](2026-09-24-an-approval-asked-during-a-tool-dispatch-is-a-human-wait.md) | 中文

## 问题

P4-05 must[0] 要求审批等待能与工具等待区分开，这样决定是否回收一个运行的监督者能看出它在等人。在原生派发路径上，`executeToolCalls` 在本批任何调用运行之前就把 agent 推到 `waiting_tool`（`packages/core/agent-loop/src/tool-calls.ts`）。随后某个调用到达风险门、需要问操作者时，风险门提议进入 `waiting_human`；状态机不允许从 `waiting_tool` 走这条边，风险门又把这次拒绝丢掉了。所以默认路径上的审批等待读起来是工具等待，被拒的转换也没有任何记录（BLOCKED-329，由 lane A 在出厂 headless profile 上的 W3 用例发现）。

## 决定

- **状态机允许 `waiting_tool → waiting_human`。** 问操作者期间，不论之前处于哪种等待，运行都在等人。风险门之后仍把运行推回 `running`，与原来一样，所以工具体在 `running` 下运行。
- **风险门记录被拒的推进。** `gateActionRisk` 把 `advanceLeasedAgent` 的每次回答交给 `warnRefusedAdvance`，由它记一条 warn，写明工具、提议的状态与拒绝原因。`no-run` 是没有挂 Run Service 的组合得到的回答，不记。动作照旧不会因为生命周期记不下来而被拒。

## 考虑过的其他做法

- **调整原生路径推进的次序，使这条边不再需要。** 未采用：风险门在工具运行时里逐个调用运行，排在整批唯一一次推进到 `waiting_tool` 之后，这样做就得把派发的那次推进挪进每个调用。
- **操作者答复后回到 `waiting_tool`。** 未采用：lane A 的 acceptance[1] 用例观测到获准的工具体在 `running` 下运行，这也是风险门一直以来的做法。

## 后果

- 在原生路径上，获准的调用使运行经过 `waiting_tool → waiting_human → running`，本批中在它之后运行的调用处于 `running` 而不是 `waiting_tool`，与本改动之前相同。
- 风险门上被拒的推进（例如因为另一台宿主持有该运行的租约而被拒）现在会出现在日志里。
