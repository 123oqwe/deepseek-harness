# Agent Note：已结束的 Run 不再开始工具调用，被拒的步会说明原因

Status: implemented

[English](2026-09-26-a-run-that-has-ended-starts-no-further-call-and-says-why.md) | 中文

## 问题

BLOCKED-332，归 P4-05 acceptance[0]。同一步里，前一个调用已把 Run 推进到 `failed`，已经产出的后一个工具调用照样执行：这一批的派发守卫只在所有调用之前跑一次，`refuseNewAction` 又不读生命周期。下一步被 Run 插件的步门拒绝，但这一轮只记了一个光秃秃的 `blocked`，既没有终态，也没有这次转换给出的原因，也没有任何客户端得知。lane A 在出厂 headless profile 上量到了这一点（A-379，run 36045150093），并写了先红用例（A-380）。

## 决定

- **已结束的 Run 拒绝之后的每个调用。** `@deepseek-ai/dsh-tools` 的 `refuseNewAction` 在原生、code-mode 与直接调用三条路径上的每个调用之前都会被问一次，现在 agent 的生命周期处于终态时它也回答 `run-ended`。它在停机与租约之后才判，所以被接管仍然读作被接管。被拒的调用按顺序得到合成结果，措辞与停机、被接管、租约被拒都不同。
- **被拒的步点名已结束的 Run。** Run 插件的步门因为生命周期处于终态而拒绝一步时，它的 `reject` 带上 `runEnded: { state, reason? }`，agent loop 把它抄到这一轮的 `blocked` 结束上。原因取自进入终态那次转换交给 `runs.advance` 的原因，由 Run 插件按 agent 记住；终态不再允许任何转换，所以这个原因一直成立。
- **客户端从会话事件流读到它。** SDK 服务端把每个会话事件原样转发（`session.event`），所以带 `runEnded` 的 `turn/end` 不需要新通道就能到达客户端。`session.status` 只有 `idle` 与 `running`，为这一个原因就得加一个新值。
- **格式版本仍为 3。** 读第 3 代日志时校验的是 `turn/end` 的信封与轮次关系，不校验原因里的成员；agent loop 之外读原因的地方都只读它的 `kind`，例如两个 SDK 客户端、ACP、Web 视图、headless 退出码与 subagent 驱动。`runEnded` 不会进入模型请求。

## 考虑过的其他做法

- **把原因存在生命周期对象上。** `advanceAgentLifecycle` 会在 `next` 里带上它，但冻结的 P4-05.U 用例逐字段比较这个对象（`packages/core/agent/tests/lifecycle-dispatch.spec.ts`）。
- **新增一种 turn-end kind。** 会话格式不用改就能接纳新的 kind，但出厂 SDK 客户端已经把被拒的步读作 `blocked`（A-380 的对照），而且每个按 kind 分支的消费者都得补上新 kind。
- **给宿主加一个生命周期事件。** 今天没有宿主读生命周期（A-380 的读码），而为某一个宿主加通道，正是更正后的条件 3 所排除的。
- **升格式版本。** 升了之后，不含这笔修复的构建会拒读一份它今天能正确读的日志。

## 后果

- 一个调用把 Run 推进到 `failed` 或 `completed` 之后，同一批里之后才开始的调用被拒为 `run-ended`。在转换之前已经并行开始的调用不会被撤回。
- 因为 Run 已结束而停下的一轮会记下 `runEnded` 与终态；转换是经 `runs.advance` 做的，还会记下原因。以其他方式进入的终态（例如插件结束一个已释放的会话）只点名终态，不带原因。
- 不含这笔修复的构建读到带 `runEnded` 的日志，会忽略这个成员，仍把这一轮读作 `blocked`。
- 验证：A-380（`tests/first100/fixtures/P4-05.terminal-dispatch.composition.spec.ts` 与 `P4-05.terminal-sdk-client.spec.ts`）、`packages/run/run/tests/ended-run.spec.ts` 与 `packages/core/tools/tests/dispatch-recheck.spec.ts`。
