# Agent Note：插件的警告与错误写到 stderr

Status: implemented

[English](2026-09-26-plugin-warnings-and-errors-reach-stderr.md) | 中文

## 问题

BLOCKED-336：出厂宿主除了 Cordis 的内存缓冲之外没有挂任何 logger exporter，所以插件写的每条 `ctx.logger.warn` 与 `ctx.logger.error` 操作者都看不见。lane A 的 A-391 在 headless profile 上量得 stderr、stdout 与工作目录下每个文本文件都是 0 行，A-394 在 ACP、SDK 与 Web 宿主上量得同样结果。只记日志的失败，例如能力令牌签发失败，不留任何痕迹。

## 决定

- **由一个插件把它们写到 stderr。** `@deepseek-ai/dsh-logger-stderr` 注册一个 exporter，按 vendored console exporter 的版式渲染 `error` 与 `warn` 消息，每一行写到 stderr，行首加 `dsh: `，与 launcher 自己的诊断一样。它从不写 stdout，那里是结果与协议帧。`dsh-base` 与 `dsh-sdk-minimal` 都挂载它，所以每个出厂宿主都写出这些行；这是 delegate 在 2026-09-26 裁定的修法 (A)。
- **挂载之前记下的内容不丢。** 它在挂载时写出内存缓冲里的消息，而 `@deepseek-ai/dsh-app-boot` 让整棵树的 logger 以 `WARN` 级别挂载，所以缓冲里既留错误也留警告。
- **headless runner 不让这些行落进推理分段。** 流式输出推理期间，它经 `routeThrough` 接管这些行：一行写出之前先收住正在进行的分段，下一段推理文字在新的头下开始。
- **两处 vendored Cordis 修正，否则会被写到 stderr 的行暴露出来。** `provide()` 的清理不再删除使用方锁成不可配置的 store 键（本地修改 21）；否则钉住的 `trustKernel` 在每次根拆除时都会记一条 `TypeError`，每次关停都会打印出来。exporter 的清理移除的是它自己的注册，而不是最近一次的注册（本地修改 22）。

## 考虑过的替代方案

- **在启动输出里点名一个日志文件。** 结项条件允许这样做；delegate 选了 stderr，每个宿主的操作者本来就看它。
- **根开始卸载时停写，而不是修正拆除时的报错。** 这依赖清理次序，而且是把真实的错误藏起来，不是消除它。
- **推理分段开着时照写。** 那一行会落进推理文字中间。

## 后果

- 任何出厂宿主的操作者都能在 stderr 上看到插件的警告与错误；供机器读取的 stdout 不变。
- 整棵树的 logger 以 `WARN` 级别输出，所以内存缓冲也留下警告。
- 被钉住的服务一直注册到进程结束。
- 没有录制会话快照覆盖这些行。headless 快照的 stderr 期望由会话日志重建（`snapshots/session/headless.snapshot.ts`），而插件的 logger 行不是会话事件；delegate 在 2026-09-26 裁定，这项改动的用户可见证据是 lane A 的 A-393 v2 在四个出厂宿主上的用例。
- 验证：lane A 在四个出厂宿主上的 A-393 v2、`packages/runtime-diagnostics/logger-stderr/tests/logger-stderr.spec.ts`、`packages/bundle/headless/tests/headless.spec.ts` 里的推理路由用例、`packages/boot/app-boot/tests/app-boot.spec.ts` 里的缓冲用例，以及 `packages/kernel/trust-kernel/tests/teardown.spec.ts`。
