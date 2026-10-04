# Agent Note：工具结果记录它的结局

Status: implemented

[English](2026-10-04-a-tool-result-records-its-outcome.md) | 中文

## 问题

Epic P3-03 的 acceptance[1] 要求每一类失败在会话日志、SDK 与 UI 中都保持类型，must[1] 要求程序的输出永远不能决定它。C 段给出了词汇（`ExecutionOutcome`）以及从错误名与错误码出发的映射，但还没有任何 `tool/result` 携带结局。另有几类失败根本没有可映射的结构化事实：pre-execute 拒绝、守卫、审批未获批准、post-execute 拦截、不是 HarnessError 的抛出错误，以及非零退出的 shell 命令——它是一个成功结果，事实放在工具的值里。

## 决定

- **一个字段，一个写入方。** `tool/result` 新增可选的 `outcome`，由会话包逐字段声明（`ToolResultOutcome`），日志因此拥有自己的格式；会话拒绝其他种类的结局。agent 循环唯一的追加点写入 `toolResultOutcome(result)`，所以 fence、lease 与被跳过调用的结果也都带上结局。
- **知道事实的生产者来记录，记在结果之外。** 结局不是内存中结果的字段，所以现有对结果字段的比较依然成立；注册表把它存在弱映射里，结果的每个副本都会带上它，由 `toolResultOutcome` 读取。注册表为自己做出的拒绝记录 `policy_denied`（pre-execute 拒绝、守卫与 post-execute 拦截来自 `policy`；审批未获批准来自 `approval`）。抛出的错误按它自己的名字与字符串 `code` 经 `outcomeOfToolError` 映射，无论是不是 HarnessError，因此 provider 拒绝上限、沙箱丢失都有了类型。其余错误结果按结构化错误信息映射。
- **工具为成功却未成的运行上报结局。** `output.outcome` 是从工具已校验的值出发的纯投影，与 `render`、`presentationMeta` 并列。bash 与 pwsh 经 `shellRunOutcome` 上报：中止、执行器的截止时间、信号或非零退出，从不依据输出，也不依据沙箱按输出匹配出来的 `denied`。
- **崩溃修复**把结局未知的调用记为带 `TOOL_OUTCOME_UNKNOWN` 的 `tool_failed`，它不会被自动重试（delegate 的裁定 Q-U1）；把从未开始的调用记为由 `interrupt` 造成的 `cancelled`。
- **新增两行**：`TOOL_TOKEN_DENIED` 记为来自 `policy` 的 `policy_denied`；`WORLD_LOST` 记为带 `lost-contact` 的 `world_lost`。E2B 的沙箱丢失变成带这个错误码的 `SandboxLostError`。
- **对模型不可见。** 结局不渲染进结果内容；模型读到的文本与之前相同。

## 考虑过的替代方案

- **在 agent 循环里只凭错误名推出结局。** 没有错误信息的拒绝与每一次 shell 退出都会变成无类型的 `tool_failed`。
- **给每种未命名的拒绝起一个错误名与错误码。** 这会改变今天没有 `error` 的结果所记录的 `error`，而生产者手里本来就有这个事实。
- **把 `ExecutionOutcome` 引入会话包。** 只为一个类型，就要新增一条从会话层到 execution-world 包的依赖边。

## 后果

- 含失败工具结果的录制会话会多出 `outcome` 字段，携带它们的 SDK 通知也一样；干净的结果不变。
- shell 拒绝仍为了提示而解析输出，bwrap/seatbelt 的 runner 失败也仍然如此；U2 会把两者都换成带外事实。
