# Agent Note：客户端与重试读取有类型的 outcome

Status: implemented

[English](2026-10-04-clients-and-retry-read-the-typed-outcome.md) | 中文

## 问题

U1 已在 `tool/result` 上记录 `outcome`。Epic P3-03 acceptance[1] 还要求 SDK 与 UI 保持这个类型，acceptance[2] 要求重试策略依据它作决定。TypeScript SDK 已经按 `SessionEvent` 的类型原样传递事件。Python SDK 把事件当作普通字典读取，没有读取函数。web 行的状态来自 `isError`、`interrupted` 代码，以及 shell 行上其 terminal 卡片解析出的退出状态；它从不给出类型。`retryClassOf` 在测试之外没有调用方。

## 决定

- **重试（delegate 的裁定 Q-U4b）。** 对不带状态码的模型失败，`isRetryableLlmFailure` 先取 `outcomeOfModelFailure` 的重试类别：`permanent` 不重试，`transient` 重试。`by-tool` 以及所有带状态码的失败仍由共享的 `classifyFailure` 判定，因为已经到达提供方的请求可能已产生效果。
- **Python。** `ExecutionOutcome`（六种类型构成的封闭字面量、各细节字段、保留额外字段）与 `tool_result_outcome(event)`；`RunResult.tool_outcomes()` 列出本次运行中每个未成功调用的调用 id 与 outcome。格式错误的 outcome 抛出 `SdkProtocolError`，与 `finish_reason` 相同。
- **Web（delegate 的裁定 Q-U4a）。** `ToolResultNode.outcome` 经由 chat 与 trajectory 两个投影携带事件中的这个字段。行状态先读它：`cancelled` 为 stopped，其余类型均为 error；没有 outcome 的结果沿用 `isError`／`interrupted` 规则。行在后缀位置以 locale 拥有的文案（六个 `outcome.*` 键）显示类型，bash 行显示在摘要之后。只因 outcome 而标为失败的行保留其折叠摘要，因为它的结果文本是命令自身的输出，不是失败行。问题行对 `ASK_CANCELLED` 与 `ASK_ABORTED` 保留自己的裁决文案。

## 考虑过的替代方案

- **状态仍取 `isError`，类型只作标签显示。** 没有 terminal 卡片、以非零码退出的命令（例如持久 shell 结果）仍会显示为成功的行。
- **对所有模型失败采用 outcome 的类别。** 带有不可重试状态码的超时会被重试。
- **Python 读取函数直接返回原始字典。** 类型将无人检查。

## 后果

- terminal 卡片已显示失败退出的 shell 行保持红色，并增加类型标签；已取消的 shell 运行原先因信号被其 terminal 卡片显示为失败，现在为 stopped。
- 录制会话中的行，只有在其日志带有 `outcome` 之后才会变化，这由 U1 的快照刷新加入。
- TypeScript SDK 不变。
