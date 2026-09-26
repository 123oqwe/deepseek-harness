# Agent Note：被优雅关停停下的子 agent 会报告给它的父 agent

Status: implemented

[English](2026-09-26-a-child-stopped-by-a-shutdown-is-reported-to-its-parent.md) | 中文

## 问题

BLOCKED-333；P5-10 must[2] 与 must[3]。宿主在一个可继续的子 agent 仍在取消中时优雅关停，父 agent 永远不会得知这个子 agent 已经停下。continuation registry 的 drain 在第一个 `await` 之前，把每个活着的子 agent 的结算提交到消息总线，由父 agent 下次启动时投递。在出厂 headless profile 上，drain 开始时总线自己的 teardown 已经清空了存储句柄，于是提交抛错，`catch` 记了一条告警，什么也没写下（lane A 的 trace，run 36048642994）。fiber 卸载时会同时启动它的全部 disposer，每个都先等一个微任务（`vendor/cordis/src/fiber.ts` 的 `_unload`）。把 `messageBus` 声明为依赖，只保证 registry 拿得到这个服务，并不能让 drain 排在总线的 teardown 之前。

## 决定

- **在卸载宣布时提交。**registry 监听 `internal/status`。当它自己的 fiber 或某个祖先进入 `UNLOADING` 时，立即关闭准入，并提交每个活着的子 agent 的结算。Cordis 在排好该 fiber 的 disposer 之后、任何 disposer 运行之前发出这个状态，所以此时总线仍然开着。`AgentRegistry` 在同一个事件上关闭它的 initiator。
- **每次关停只做一次。**drain 调用同一步，第二次什么也不做。直接调用的 drain 仍会提交；已经成功的提交不会在关闭的总线上再试一次。

## 考虑过的替代方案

- **推迟总线清空句柄。**这会把问题移进 provider，它需要一条规则，规定正在关闭的存储还能接受什么。
- **持有服务背后的存储。**§12.40 拒绝了越过服务去拿存储。
- **在 Cordis 里给卸载排序。**vendored 运行时的改动会波及每个插件的 teardown。

## 后果

- 准入在卸载宣布时关闭，而不是在 drain 开始时关闭，早几个微任务。
- 这个修复依赖 Cordis 在 fiber 的 disposer 运行之前发出 `internal/status`。一旦这一点改变，lane A 的 shutdown-while-cancelling 用例会失败。
- 不涵盖：仍然写不进的结算只经 `ctx.logger` 记录，而出厂 headless profile 不导出它（BLOCKED-336）。把它报告到操作者看得见的地方，要等那一条。
- 验证：lane A 在出厂 headless profile 上的五条用例（A-389 到 A-389d，挑入为 `e3ab7e7ed9`）。其中四条在本修复之前的树上是红的，作为对照的一条在修复前后都是绿的。
