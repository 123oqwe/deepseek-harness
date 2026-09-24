# Agent Note：workflow 工具续跑被中断的运行，并返回子 agent 的真实输出

Status: implemented

[English](2026-09-24-workflow-resume-returns-real-outputs-and-reports-a-refusal.md) | 中文

## 问题

P4-08 acceptance[0] 要求：在 `agent()` 边界被杀掉的工作流，由重启后的宿主续跑，且不重复已完成的子 agent 工作；acceptance[1] 要求脚本改动后的续跑被明确拒绝。出厂 acp profile 上有四处缺口。其一，`workflow` 工具没有任何参数能调到 `engine.resume`；它的参数根接受未知键，所以带 `resume` 的调用会以新 id 另起一次运行。其二，journal 把每个已完成步骤的输出都记成占位串 `agent-result-<seq>`，续跑时交给脚本的是这个字符串，而不是子 agent 的值。其三，因 `script-digest-changed` 被拒的续跑会从第一步运行脚本，调用方得不到任何提示。其四，worker 一报告步骤完成，宿主就把它记入 journal，而此时子 agent 的 `turn/end` 可能还在会话后端的写入批次里：在这之间被杀，journal 写着一个已完成的步骤，子 agent 的日志却看不出来，续跑于是再次启动这个子 agent。

## 决定

- **`workflow` 接受 `resume: "<runId>"`**，把本次调用的 `script`、`meta`、`args` 与父 agent 以该 id 交给 `engine.resume`。取值必须匹配 `^[\w-]+$`；`resume` 与 `detached: true` 同时给出时拒绝。
- **worker 把每个已完成的 `agent()` 值以 JSON 文本上报**，随 agent-end 消息发出：结构化值，或输出文本。宿主只把它交给 journal，从不交给 `workflow/agent-end` 监听器；journal 内联记录它，续跑的步骤返回解析后的值。
- **被拒的续跑报告在运行上，而不是抛出。** `Reconciled.refused` 带出 `admitResume` 的 `reason` 与 `detail`，`WorkflowRun.resumeRefused` 公开它们，工具封闭的输出 schema 新增可选字段 `resumeRefused`，模型读到的文本以 `resume refused (<reason>): the run started over from its first step.` 开头。
- **宿主在把已结束的进程内子 agent 的结果转发给 worker 之前，先刷写它的会话**，所用的 `ctx.sessions.flush` 调用与 `subagent/continuation-activation.ts` 相同。刷写失败记一条 warn，结果照常转发。

## 考虑过的其他做法

- **在宿主侧推导输出（核验 V5）。** 未采用：宿主要复制一份 worker「`agent()` 返回什么」的规则，而已冻结的 `runtime.ts` 还得导出 `outputText` 并补上导出 JSDoc。输出由 worker 上报，与诊断的 B2 一致。
- **按诊断的写法（`&& event.output !== undefined`），把没有带输出上报的已完成调用记为没有输出。** 未采用：已冻结的 `journal-host.spec.ts` 有三条用例上报已完成调用时不带输出，并断言续跑时跳过该步骤。observer 对这类调用保留占位串。
- **在 `resume.ts` 判定可复用时拒绝占位串（A7）。** 未采用：已冻结的 `journal-resume.spec.ts` 以 `'agent-result-1'` 作为输出 fixture，并断言它可复用。回退放在 `runtime.ts`：记录的输出不是 JSON 时，该步骤重跑。
- **端到端用例改用 detached 运行（V4）。** 本次未采用：改动需要 delegate 裁定。用例使用前台运行，并从 journal 文件名读出它的 id。
- **给内联输出设大小上限（V8）。** 未做：写盘代价写在 `AgentEndEvent.output` 的 JSDoc 里，上限等待裁定。
- **照工单把模型给的 `resume` 值原样交给引擎。** 未采用：这个 id 会成为 journal 文件名（`join(directory, id + '.json')`，该文件还会被写入）和租约行的名字，不校验就能让模型在 journal 目录之外写 `.json` 文件。
- **桩模型的工具调用 id 固定为 `stub-<n>`。** 未采用：同一个会话先后经过两个桩时会两次遇到 `stub-1`，所以用 `StubToolCall.id` 让用例给调用命名；默认值不变。

## 后果

- 宿主在每个步骤边界重写整个 journal，所以每份内联输出在之后的每个边界各写一次；没有任何上限限制输出大小。
- 本次改动之前写成的 journal 保存的是占位串，续跑会重跑这些步骤。
- 被拒的续跑仍以同一个 id 从第一步运行脚本；`resumeRefused` 是调用方得知没有复用任何步骤的唯一途径。
- 工具拒绝不匹配 `^[\w-]+$` 的 `resume` 值，例如含 `.` 的值；worker-thread 引擎生成的 UUID 都匹配。
- 工具从不显示前台运行的 id，崩溃的运行也不会返回结果，所以在出厂产品上没有任何途径把可续跑的 id 交给模型；端到端用例观测的是工具续跑一个交给它的运行（V4）。
- 子 agent 在结果转发之前已被处置时（例如运行仍有子 agent 在跑时调用 `dispose()`），刷写失败，宿主记一条 warn。
- `engine.resume` 先取该运行的租约；此后若对账抛出异常，或 `launch` 校验失败，租约不会释放，要等 30 秒后到期，期间以同一个 id 重试都会被拒。现在模型通过工具就能走到这条路径。
- 续跑会在同一个会话里为同一个运行 id 再写一条 `tool-workflow/run-start`，测试用的 invariant 会把它报告为重复运行（A8）。
- journal 只按运行 id 命名，不记录归属，所以任何知道某个运行 id 的会话，都能用自己的权限续跑那个运行。
- `stub-model.ts` 没有单元测试，覆盖率状态与改动前相同。
