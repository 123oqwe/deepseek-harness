# Agent Note：直接调用工具之前先写 manifest、再由执行点决定

Status: implemented

[English](2026-09-26-direct-tool-calls-are-manifested-and-decided.md) | 中文

## 问题

BLOCKED-294；P2-03 acceptance[0]、P2-05 acceptance[0]。`ToolRuntime.execute` 是插件直接调用的公开接缝，Cordis 教程也这样教。它检查 capability token，跑 `tools/pre-execute` waterfall 与 guard，然后运行工具，既不追加 ActionManifest，也不问策略执行点。lane A 在出厂 headless profile 上量过：
- A-434（run 36204057122）：代表根 agent 的直接调用没有 manifest、没有决定；照教程不带 agent 的调用也没有决定。随后 token 门拒绝了这两次调用。
- A-462（run 36212808158）：插件工具在执行体里出示它被准入时的令牌、嵌套调用写文件，照常运行并写出了文件，没有 manifest，也没有决定。

## 决定

- **接缝先记录、再决定。** 钉了 Trust Kernel 时，`execute` 先把这次调用的 ActionManifest（origin 为 `plugin-rpc`）追加到发起调用的 agent 的会话里，再问执行点，之后才检查 capability token。决定不是 permit 就拒绝调用，所以即使调用会被 token 门拒绝，manifest 与决定也都已留下。
- **执行点看到的是调用出示的令牌。** 插件工具体内的嵌套调用出示它自己被准入时的那枚令牌，这枚令牌由运行时交给工具体；插件自己的顶层调用不出示令牌。执行点收到的是 P2-02 审计过的投影。
- **不带 agent 的调用一律拒绝。** 没有会话能记录它的 manifest。manifest 照样构造但不追加，执行点以 fail closed 的事实作出决定，内核审计记下这个决定，然后拒绝调用。
- **它会问本宿主还能不能行动。** 不论有没有内核，都在写 manifest 之后、按决定行事之前（这是原生路径的次序），紧急停止生效时、或 run 已被另一个宿主接管时拒绝调用（BLOCKED-345）。没有控制通道也没有租约的 agent 放行，与原生路径相同。
- **只有一份实现。** manifest 请求与决定用的正是 code mode 子派发所用的那一份，从 `ptc.ts` 挪到了 `external-effect.ts`。code mode 写出的 manifest 逐字节不变。
- **manifest 与决定只在钉了内核的组合里生效。** 出厂 profile 都钉了内核：`enforceTrustKernelPosture`（`apps/cli/src/profile-boot.ts:383`，在 `:643` 调用）在没有内核时拒绝启动，除非用 `DSH_TRUST_KERNEL_INSECURE` 选择开发模式启动；用例在 `apps/cli/tests/trust-kernel-launch-posture.spec.ts:45`。没有内核的组合没有执行点，它的直接调用也不追加 manifest，这一点与 agent loop 自己的调用不同。工具包的 README 写明了这个不对称。

## 考虑过的替代方案

- **把接缝声明为内部接缝**，并加结构守卫，不让出厂代码调用它，也就是 BLOCKED-294 的第二条结项路径。这样工具体内的嵌套调用，也就是 A-462 量到的那种，仍然不被记录。
- **只要带了 agent，不论有没有内核，直接调用都写 manifest。** 63 个测试文件里有 231 处直接调用带了 agent，在没有执行点作决定的组合里，它们的会话日志都会变。

## 后果

- 工具体内的嵌套写在运行之前就被记录，并由执行点决定；A-462 的用例转绿。
- 教程给出带 `agent` 的调用写法，并说明不带时会怎样。
- 三个单元测试为了测令牌而钉了内核，却没有 decider：`capability-token-file` 的 `provider.spec` 与 `renewal.spec`，以及 `subagent` 的 `capability-token-spawn.spec`。没有 decider 时每个决定都是拒绝，所以它们的直接调用现在会停在这些用例要测的 token 门之前。它们改为钉上出厂 profile 所用的 decider `endorseComposedDecision`，并配一个放行其工具的策略，出厂策略集对这些工具也是放行。标题与断言都不变；`provider.spec` 与 `capability-token-spawn.spec` 由 P2-02 的 [230] 冻结。
- 不涵盖：四个 web e2e 文件（`background-job-list`、`replay-round-trip`、`schedule-after`、`shipped-composition`）在钉了内核的 web 组合里直接调用，没有任何 first100 运行会执行它们。询问操作员的风险门不作用于这条接缝（A-471 已量到，另行修复）。
- 验证：lane A 在出厂 headless profile 上的 A-434、A-462 与 A-472，以及 `packages/core/tools/tests/direct-seam.spec.ts`。次序变异 M-615-order 把 manifest 改在派发之后追加，A-462 的用例与观察次序的单元用例都会转红。
