# Agent Note：未成功执行的类型化结果

Status: implemented

[English](2026-10-04-a-typed-outcome-for-an-unsuccessful-execution.md) | 中文

## 问题

Epic P3-03 要求类型化的结果：`policy_denied`、`resource_exhausted`、`timeout`、`cancelled`、`tool_failed` 与 `world_lost`，由控制通道决定、绝不由程序写出的输出决定，好让重试按类型决策、每个界面都保留类型。现在一个工具结果至多带着结构化的错误名与错误码，各个消费方各自解读，没有任何地方给出这六类。

## 决定

- **词表放在 `@deepseek-ai/dsh-execution-world`。** `ExecutionOutcome` 是按 `kind` 区分、带类型化细节的封闭联合，`retryClassOf` 把每一类标为 `permanent`、`transient` 或 `by-tool`。
- **两张封闭映射只读结构化事实。** `outcomeOfToolError` 读工具错误的名字与错误码，`outcomeOfModelFailure` 读模型失败的错误码。拒绝名只有带着派发前错误码 `ABORTED_BEFORE_DISPATCH` 才算数；表里不认识的名字或错误码是 `tool_failed`；名字用 `Map` 查找，所以原型上的键绝不会被当成拒绝。
- **围栏与租约不是策略。** `FencedError` 是 `cancelled`，by `fenced`（该 run 原本持有工作项、被另一持有者接管；permanent），`LeaseRefusedError` 是 `world_lost`，reason 为 `lease-refused`（工作项由另一持有者拥有；以后的尝试可能拿到）。两者都不是某条策略做出的拒绝（delegate 的裁定，2026-10-04）。
- **模型侧映射放在这里，按结构读取。** `@deepseek-ai/dsh-llm` 不能引用本包：本包已经经由 sandbox 与 session 依赖到模型层。`outcomeOfModelFailure` 接收 `{ code }`，`LlmFailure` 满足它。

## 考虑过的替代方案

- **为竞争加第七类。** 它最准确地描述被拒的租约，但扩大了条文列出的六类；带 reason 的 `world_lost` 已能承载。
- **把词表放在 `@deepseek-ai/dsh-llm`。** 那样模型层就要定义工具执行的词表。

## 后果

- 还没有地方记录结果：派发在 `tool/result` 上写 `outcome`、为守卫与 pre-execute 的拒绝给出结构化名字、SDK 与 UI 显示类别，都在 Use 阶段跟进。
