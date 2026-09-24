# Agent Note：令牌会拒绝的调用不再先交给操作者审批

Status: implemented

[English](2026-09-24-a-call-its-token-will-refuse-is-not-put-to-an-operator.md) | 中文

## 问题

BLOCKED-330。两条派发路径都先过风险门，再由 `ToolRuntime` 准备调用，而 capability token 的检查只在准备阶段做。于是令牌会拒绝的调用先到了风险门。风险门要问人时，就有人被请去批准一个跑不了的动作，批准之后调用照样被拒。出厂构建上会这样的有三种情形：会话令牌已过期（`sessionTokenTtlMs`，默认 24 小时，过期后不重签，见 BLOCKED-331）；签发失败；子 agent 的令牌作用域不含该工具。lane A 在出厂 headless profile 上、两条路径都观察到了：出示过期令牌的调用先交给了操作者，之后以过期被拒。

## 决定

- **令牌检查只有一个函数，在三处调用。** `ToolRuntime` 的私有方法 `capabilityRefusal(input)` 承载准备阶段原有的检查：令牌是否出示、是否过期、是否已撤销、动词与资源作用域；撤销状态向令牌提供方查询。准备阶段仍在原处调用它，内部接口 `ToolRuntimeScheduler` 以 `capabilityRefusal` 暴露它。
- **两条派发路径都在风险门之前调用它。** 原生路径（`agent-loop` 的 `tool-calls.ts`）与 code-mode 的内嵌派发（`ptc.ts`）在派发拒绝与策略决定之后、审批绑定之前调用它。被拒时，调用以准备阶段会给出的同一个结果结束：不请求审批，不占预留，工具体不运行。

## 考虑过的其他做法

- **把准备阶段、或其中所有会拒绝的检查，挪到风险门之前。** 未采用：准备阶段还运行 `tools/pre-execute` waterfall 与 guard，它们今天在风险门与预留之后运行。
- **把令牌传给 `gateActionRisk`，在那里检查。** 未采用：风险门会另存一份「某个作用域是否要求令牌」的规则，而这条规则在注册表的各层里。
- **在批次签发令牌时就拒绝。** 未采用：令牌每个批次签发一次，而过期与作用域是按调用判定的。

## 后果

- 准备阶段仍检查令牌。操作者决定期间令牌过期的调用，在批准之后于准备阶段被拒。
- 在此之前，被令牌拒绝的调用已经在 action ledger 里预留了效果，错误结果随后把这条预留标为 ambiguous：ledger 里留下一条要由人或 reconciler 处理的记录，而那个动作从未运行。code-mode 路径上，这个调用还会写下 `tool/ptc-dispatch-start`。现在令牌拒绝与策略拒绝、风险门拒绝一样，两样都不留下。
- 既被 code-mode 呈现折叠、又会被令牌拒绝的调用，现在报告的是令牌拒绝，因为派发路径在准备阶段检查折叠之前先问令牌。
- `ToolRuntimeScheduler` 新增一个成员，tool-cordis 的 API 目录随之变化；P9-07.P 在带上这项改动的那一班重新观测。
- 在挂载时创建的配置 agent 可能与令牌提供方竞争，出示不了令牌。出厂 profile 都不用 `agents: [...]`，所以记作 agent-loop 的 Known Limitation。
