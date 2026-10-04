# Agent Note：Agent Team 工具声明各自的风险域

Status: implemented

[English](2026-10-04-agent-team-tools-declare-their-risk-domains.md) | 中文

## 问题

实验性的 `dsh-experimental-tool-agent-team` 的 9 个工具都没有声明风险域标签，出厂风险门按 unknown 默认把每次调用判成 `security-sensitive`，要求审批。headless 运行没有审批人，所以每次调用都以 `unavailable` 结束：`spawn_teammate` 起不了队友，Lead 对任务板的调用也一次都没执行。自风险门出厂以来，每棵树上的 headless Agent Teams e2e 都超时（B-727，探针 37182024548、37182551593）。

## 决定

- 每个工具声明与出厂同类工具相同的标签：`spawn_teammate` 用 `agent-spawn`（同 `subagent`）；`send_message`、`interrupt_agent` 用 `agent-control`（同 `tool-subagent-control`）；`list_agents`、`team_task_list`、`team_task_get`、`wait_agent` 用 `catalog-read`（同 subagent 的 `list_agents`）；`team_task_create`、`team_task_update` 用 `session-state-write`（同 `todo_write`）。
- 共用的免 key 夹具（`apps/cli/tests/profiles/headless/tests/fixtures/team-llm.mjs`）报告上下文窗口，并对不提供工具的请求（例如会话标题）回文本，这样 e2e 的 stderr 里只剩它断言的那一行来源告警。

## 考虑过的替代方案

- **让 e2e 用宽松的权限预设跑。** 这会把缺陷藏起来：headless 部署的 Agent Teams 仍然每次调用都被拒。

## 后果

- headless 的 Agent Team 在出厂风险门下能从头跑到尾；每个 Team 工具都和它的出厂同类工具一样受门控。
