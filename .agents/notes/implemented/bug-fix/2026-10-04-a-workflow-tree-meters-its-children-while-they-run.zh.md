# Agent Note：workflow 树在子运行时就计量

Status: implemented

[English](2026-10-04-a-workflow-tree-meters-its-children-while-they-run.md) | 中文

## 问题

workflow 树的 token 上限（`maxNestedTokens`）只在 `agent()` 起子时检查，子用掉的 token 也只在子结算时才从树里扣。树用完时还在跑的子会接着跑，一个子就能花掉上限的好几倍（B-714；P4-09 acceptance[3]、must[3]）。

## 决定

- 有子在树的 token 上限下启动后，workflow host 订阅 `session/event`。在跑的进程内子的会话每记下一个事件，就按 token-meter 的 `tokenUsage` 投影，扣掉该子自上次扣减以来用掉的部分。
- 某次扣减让树降到零或以下时，本 run 以 `token-budget-exhausted` 中止所有在跑的子；之后的 `agent()` 调用照旧被拒。结算时只扣剩下没扣的部分。
- run 结算时停止订阅。只改 `packages/workflow/workflow-worker-thread/src/host.ts`。

## 考虑过的替代方案

- **把剩余额度作为硬上限传给每个子。** 每个 subagent provider 都得执行它，要改 subagent 能力面的全部三个角色。同时在跑的几个子各自拿到全部剩余，仍会一起超出。
- **把剩余额度平均分给允许同时在跑的子。** 越限会缩到一个响应，但树用不满自己的额度，上限也更难配置。

## 后果

- 树最多超出上限「那一刻在跑的每个子各一个模型响应」，因为用量要等一次响应结束才进会话。
- 嵌套 run 的子在自己下一次记下用量时才停，而不是在树里另一个 run 用掉最后一个 token 的那一刻停。
- 未覆盖：并发下不超预算是 P4-10 acceptance[0] 的条款。
