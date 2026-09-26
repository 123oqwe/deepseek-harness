# Agent Note：被中断的子 agent 只在真正停下之后才成为 terminal，并拒绝被中断抢先的提示词

Status: implemented

[English](2026-09-25-an-interrupted-child-is-terminal-only-once-it-stops.md) | 中文

## 问题

P5-10。`interruptByParent` 把中断记为子 agent 控制路由上的 `cancelling`，此后再没有代码推动它：没有任何地方报告子 agent 已经停下，所以 must[3] 所说的屏障从未闭合。在中断之前已判定、但还在送往子 agent inbox 途中的浏览器提示词，照样被投递并唤醒子 agent（acceptance[0]）；lane A 的 K1b 在出厂 headless profile 上观测到了这一点（run 35985477815）。每条浏览器提示词都按 `continue` 判定，所以子 agent 等待人工回答时，Steer 投递的提示词也被准入（must[0]）。收敛之后的第二次中断还会重新打开屏障。

## 决定

- **子 agent 停下才闭合屏障。**`interruptByParent` 在中断时查到子 agent 的 Agent，并在它的 `whenIdle` 落定时（无论成功与否）报告 `child` 参与者已停下；查不到 Agent 时立即报告已停下。路由随之从 `cancelling` 进入 `terminal`。之所以在中断时查，而不是在构造路由时查，是因为冷恢复可能已经替换了 Agent。
- **terminal 的子 agent 保持 terminal。**`observeCancelled` 在 `terminal` 下不起作用，所以收敛之后的第二次中断不会重新打开屏障。
- **每个子 agent 一个取消信号，由中断触发。**运行时在路由旁为每个子 agent 保留一个 `AbortController`，并把 `AbortSignal.any([调用方, 子 agent])` 交给提示词的投递。inbox 已经在最后一个同步截止点检查这个信号（`continuation-activation.ts` 的 `submitAdmitted`），所以落在判定与 inbox 之间的中断会使这条消息被拒。提示词以 `subagent/not-resumable` 被拒，形状与判定拒绝相同，理由取路由此刻给出的理由。
- **提示词按投递方式判定。**Steer 投递的提示词按 `steer` 判定，Queue 投递的按 `continue` 判定，与它们的派发方式一致。

## 考虑过的替代方案

- **把 `AbortController` 放在路由上。**照核验的 V6 没有采用：`continuation.ts` 看不见路由，路由的契约也保持不变。
- **投递之后再判定一次。**太迟：消息已经进入 inbox。
- **让中断也持有子 agent 的锁。**消息仍可能排在中断之后入队，而且中断会失去同步准入。

## 后果

- 每个子 agent 的取消信号与路由保留同样久：运行时见过的每个子 agent 各一个（`control.spec.ts` 的 KNOWN GAP 用例）。
- 被中断过一次的子 agent 会拒绝之后的每条浏览器提示词。模型的 `send_message` 路径传的是它自己的信号，不受影响。
- 验证：lane A 在出厂 headless profile 上的 K1b，以及 `control.spec.ts` 里的运行时用例：R2b、R2c 与 R3 在本修复之前的树上是红的，作为对照的 R2a 在修复前后都是绿的。
