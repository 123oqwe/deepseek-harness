---
description: "guard 家族的包映射：建议性重复工具提醒、单次工具调用超时策略，以及启动期基线漂移预检查，供选择或组合 guard 的用户与维护者阅读。"
kind: "package-group"
---

# guard/：guard 家族

[English](README.md) | 中文

## 概述

`guard/` 组监视 agent loop 自身逻辑之外的失败模式。`repeat-tool-reminder` 会在模型重复完全相同的工具调用时提醒它改变方法或结束任务，让卡住的循环不再浪费时间和 token。`timeout-policy` 为声明了限时的工具调用设置时间上限，让挂起的调用向模型返回清晰的超时错误，而不是拖住整个会话。`baseline-preflight` 在启动时先于这一切运行一次：如果 checkout 相对已捕获的架构/协议基线发生漂移，它会中止启动，而不是让执行批次针对过期指纹运行。`repeat-tool-reminder` 与 `timeout-policy` 随 `dsh` base 组合默认启用；`baseline-preflight` 在其中的行带有 `disabled: true`（按 profile 选择性启用——原因见它自己的 README）。组合可以调优、启用或移除任意一个。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

三个小插件分别覆盖三种模式；下文每个 README 都说明何时保留、调优或移除它。

| 包 | 提供什么 |
|---|---|
| [`repeat-tool-reminder/`](repeat-tool-reminder/README.zh.md) | 在模型重复相同工具调用时提醒它，使其改变方法或结束任务 |
| [`timeout-policy/`](timeout-policy/README.zh.md) | 为声明了限时的工具调用设置超时，让模型得到清晰错误而不是无限等待 |
| [`baseline-preflight/`](baseline-preflight/README.zh.md) | 在 checkout 相对已捕获的架构/协议基线发生漂移时中止启动 |

-----

<a id="related-documentation"></a>
## 相关文档

先从工具子系统参考了解工具调用流水线，再看重复提醒的配置与策略背后的超时库决策。

- [工具子系统参考](../../docs/subsystems/tools.zh.md)——两个工具调用 guard 都依赖的工具调用流水线与决策。
- [生成配置目录](../../docs/config-catalog.zh.md#deepseek-aidsh-repeat-tool-reminder)——重复调用提醒的每个受支持字段。
- [超时截止时间库 Agent Note](../../.agents/notes/implemented/architecture/2026-07-06-timeout-deadline-library.zh.md)——`timeout-policy` 所执行的时序／终止拆分。
- [测试策略](../../docs/testing.zh.md)——`baseline-preflight` 所实现的启动期校验门禁，以及基线指纹报告格式。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
