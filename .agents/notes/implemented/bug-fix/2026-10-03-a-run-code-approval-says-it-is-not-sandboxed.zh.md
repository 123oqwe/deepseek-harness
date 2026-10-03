# Agent Note：run_code 的审批写明程序不在沙箱里

Status: implemented

[English](2026-10-03-a-run-code-approval-says-it-is-not-sandboxed.md) | 中文

## 问题

`run_code` 在宿主的 worker 线程里执行模型写的程序，这是收容而不是安全边界：不论会话的沙箱模式是什么，程序都能读写用户账户能读写的任何文件，包括 `$DSH_HOME` 之下的文件。在 `read-only` 与 `workspace-write` 下，这个调用会被问到，因为它不声明风险域标签，按 `security-sensitive` 归类。审批请求展示的是 P2-06 的六项，参数已脱敏，没有一项说出这一点（第 34 题；A-601 在出厂的 headless 启动上观测到）。Web 审批卡的详情行显示 `bash` 的命令，却不显示程序，程序收起在对话里。

## 决定

- **工具声明的须知。** `ToolDefinition.approvalNotice` 经 `defineTool` 传入，写明批准该工具的任一调用在 manifest 各字段之外还放行了什么。它按工具固定，模型永远看不到。`run_code` 声明的是："This code does not run in the OS sandbox: it can read and write any file your account can, including $DSH_HOME."
- **由展示带出。** `approvalDisplayFor` 接收被分发工具的须知，作为 `ApprovalDisplay.notice` 加入；原生、直接与 code-mode 三条分发路径都传它。
- **Web。** 审批卡把须知作为第一行详情显示，标签走 `approval` 字典。详情槽在调用没有 `command` 时显示其 `code`，于是被批准的程序连同换行出现在卡上。
- **ACP。** `session/request_permission` 把 `Notice: …` 放在 tool call 内容的第一条。程序在这个请求之前已作为 `tool_call` 更新的 `rawInput` 发给客户端。

## 考虑过的替代方案

- **改 `run_code` 的 manifest `expectedDiff`。** manifest 会记入日志并参与摘要，于是每份含 `run_code` 调用的录制会话夹具都会因为一句属于审批而不属于动作记录的话而改变。
- **让各展示面按名字认出 `run_code`。** 那样每个展示面都要各自持有这件事，新加的展示面会漏掉；在沙箱之外运行的工具自己最清楚，由它来写明。

## 后果

- Web 上或 ACP 客户端里的审批人，在请求本身上就被告知：批准的 `run_code` 程序能读写账户能读写的任何文件。
- `headless` 与 `sdk` profile 不挂审批应答方，在那里这个调用仍按 `unavailable` 被拒，没有人看到请求。
- 不涵盖：让 `run_code` 在受沙箱约束的子进程里运行，归 P3-05（第 34 题 (c)）。
