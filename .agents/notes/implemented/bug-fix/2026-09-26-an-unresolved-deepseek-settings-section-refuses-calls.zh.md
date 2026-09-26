# Agent Note：尚未解析成功的 DeepSeek 设置分节拒绝调用

Status: implemented

[English](2026-09-26-an-unresolved-deepseek-settings-section-refuses-calls.md) | 中文

## 问题

B-646，来自 P4-11 的盲审。`llm-deepseek` 在加载时解析组合条目，并把结果留作最后有效的连接事实。`llm-deepseek` 设置分节接入后，若其快照没通过解析步骤，提供方就回落到这个值：调用发往组合条目的端点并使用它的密钥引用，而该分节指定的是另一个端点。唯一的记录是一条 `ctx.logger` 错误，headless 运行看不到它（BLOCKED-336）。在[重试代码列表被移除](2026-09-26-one-retryability-verdict-for-the-breaker-and-llm-retry.zh.md)之前写下的设置文档会走到这条路径：Schemastery 保留未知的 `retryPolicy.retryableCodes` 键，`resolveRetryPolicy` 拒绝它。

## 决定

- 最后有效值属于产生它的配置来源。`setSource` 会清空它，所以接入以来尚未解析成功的分节没有最后有效值。
- 没有最后有效值时，每次调用都以 `LlmError` 失败，code 为 `INVALID_SETTINGS`，消息点名该分节并带上解析错误，不发出任何请求。拒绝发生在 `prepareCall` 中，早于断路器对首个 chunk 的守卫；该 code 属于 `unclassified`，所以 llm-retry 不会重试它，断路器也不会计入它。
- 注册保留它捕获的重试策略，被拒绝的调用都到不了这份策略。每次设置变更只记录一次拒绝。
- 命名空间照常注册，因此 Models 页面或对文档的编辑都能修复该分节；下一个解析成功的快照恢复服务。
- 解析成功过、之后才失败的分节，仍保留它自己的最后有效事实。

## 考虑过的替代方案

- **忽略 `retryableCodes` 并给出警告。** 首个版本发布之前，后端拒绝旧的落盘格式，而重试策略已经在加载时拒绝这个键；在这里忽略它等于加一层兼容垫片。
- **像 `llm-pi-ai` 那样用 `validate` 钩子拒绝注册。** 该分节在可选的 `ctx.inject` 回调里注册，回调中的抛出是否会中止启动尚未确认；拒绝注册还会让 Models 页面没有可修复的分节。

## 后果

- 带有这种文档的 headless 运行会打印 `dsh: INVALID_SETTINGS: …` 并以非零状态退出，而不是调用另一个端点。
- `llm-pi-ai` 经由 `validate` 钩子拒绝同一个键，于是它的整个分节注册失败。base bundle 挂载它时没有组合路由，所以不会改道；缺少的诊断记在 B-648 下。
- 验证：lane A 的 A-499，以及 `dynamic-config.spec.ts` 中在启动前写入已移除键的用例。
