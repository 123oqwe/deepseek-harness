# Agent Note：SDK 协商结果进入每个 Run，对端的字段一个不丢，拒绝以字段说明原因

Status: implemented

[English](2026-09-24-sdk-negotiation-reaches-every-run-and-refusals-carry-fields.md) | 中文

## 问题

P8-01 的验收已撤回（BLOCKED-314），P0-06 acceptance[1] 也未关闭，原因是出厂 SDK 路径上的几处缺口：

- 客户端丢字段。Python 客户端的 `InitializeResponse` 没有 `protocolVersions` 与 `schemaFingerprint`，它的 `NegotiationProvenance` 没有 `downgrades`，它的模型还会丢掉每一个没有声明的字段。TS 客户端交给调用方的是常量 `downgrades: []`，并且只用它认识的字段重建 `initialize` 结果。
- `SERVER_PROTOCOL_SURFACE` 是 schema 指纹所哈希的清单，它是手写的，已经与服务端脱节：它把实际分派的 `session/prompt` 写成了 `session.prompt`，并且漏掉了 `shutdown`、`subagent.started`、`subagent.finished` 与 `human/question`。
- 服务端把达成的协商结果回给客户端，却没有任何地方记录它，所以没有一个 Run 带着 provenance（acceptance[4]）。
- 拒绝只是消息里的文字。传输层对处理器失败只以 `-32603` 与错误消息作答，所以服务端的版本、能力与 schema 三种拒绝在 wire 上丢了字段；`initializeNegotiated` 也只在消息里列出服务端未同意的能力（acceptance[1]）。

## 决定

- **两个客户端都保住对端发来的内容。** TS 客户端从 wire 上读取 `downgrades` 并逐条校验：列表缺失时读作 `[]`，畸形时整条 negotiation 丢弃，与 Python 客户端一致。结果本身、`serverInfo`、`protocolVersions`、negotiation 及其每一条降级、`hostControl` 及其停止记录，都保留客户端没有建模的键。Python 端，`InitializeResponse` 新增 `protocolVersions` 与 `schemaFingerprint`，`NegotiationProvenance` 新增以 `CapabilityDowngrade` 模型表示的 `downgrades`，回复中的每个模型都允许额外字段。
- **协议面字面量原地改正。** `SERVER_PROTOCOL_SURFACE` 列出 `session/prompt` 与 `shutdown`，它的 events 是服务端发起的每一条消息，包括它发给对端的唯一一个请求 `human/question`。`shutdown` 没有参数类型，所以它的 schema id 是不注册的名字 `sdk-protocol:ShutdownRequest`（delegate 对 A5 的裁定）。有一条用例让这张清单与 `handleRequest` 分派的方法、服务端发出的名字双向相等。`spec/control-protocol.schema.json` 已重新生成，指纹随之改变。
- **拒绝带上字段。** 传输层的 `-32603` 应答在抛出值自身有 `data` 属性时携带该 `data`。服务端的拒绝都设置了它：版本拒绝为 `reason`、`client` 与 `server`；能力拒绝为 `reason` 与 `capability`；schema 拒绝为 `code`、`schemaId`、`encounteredVersion` 与 `registeredVersion`。`initializeNegotiated` 以 `SdkProtocolError` 拒绝，其 `data` 为 `{ reason: 'mandatory-capability-not-agreed', capabilities }`。
- **Run 记录自己的 provenance。** `RunService.recordProvenance` 把 `Run.provenance` 持久写入，只写一次；已经带有 provenance 的 Run 保留原值（V4d）。SDK 服务端为该连接保留握手的协商结果，并对它创建的每个会话等待 `recordProvenance` 完成。它经名字（`runs`）和一个本地结构类型取到 Run 服务，与取宿主用户工厂的方式相同，所以服务端包不依赖 run 包。`RunPlugin.open` 让子 agent 会话的 Run 取其父会话 Run 的 provenance。

## 考虑过的其他做法

- **为协议面条目注册一个 `ShutdownParams` wire schema（B6）。** 未采用：没有任何东西要求协议面上的 schema id 已注册，而每注册一条就多一个 identity migration，P0-06 关于注册集完整性的工单就得为它补上覆盖（V11）。
- **从分派器推导协议面。** 未采用：delegate 裁定原地改字面量，外加一条双向比对的用例（V1）。
- **为 ACP 连接记录 provenance。** 未做：ACP 的 `initialize` 忽略它的参数，不做任何协商，在那里记录结果就是新增一种 provenance 变体。这个范围问题已作为第 17 题交给用户。
- **覆盖接续 Run 的 provenance。** 未采用：Run 保留它开出时的协商结果。

## 后果

- 在 SDK 连接之外开出的 Run（经 ACP 或在 headless profile 上）不带 provenance。没有挂载 Run 服务的组合什么也不记录，它的握手照常成功。
- 出厂服务端不产出非空的 `downgrades`，因为兼容适配器不存在（must[3]）。客户端这一半用对端发来的列表证明；服务端这一半随 must[3] 另证（BLOCKED-314 关闭条件 1）。
- 子 agent 的 Run 在打开之后，以一次受跟踪的写入取得父 Run 的 provenance，而不是在它的第一步之前。
- 版本或能力拒绝现在以字段形式向未经认证的对端展示服务端自己的区间或被拒的能力；这两者原本就已写在消息里。
