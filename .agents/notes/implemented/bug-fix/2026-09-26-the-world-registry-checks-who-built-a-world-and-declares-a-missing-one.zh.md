# Agent Note：world 注册表核对 world 由谁造出，没拿到所要 world 的会话会写明这一点

Status: implemented

[English](2026-09-26-the-world-registry-checks-who-built-a-world-and-declares-a-missing-one.md) | 中文

## 问题

BLOCKED-316，归 P3-01 acceptance[1] 与 acceptance[2]。world 注册表把新建 handle 的 `provider` 与 `spec` 原样抄进绑定、策略事实与审计，不做核对，而 `register` 是公开的，所以插件的 provider 可以自称 `local`，带任意摘要。部署若要求一个没有 provider 承载得了的 world，又没有规则禁止 `absent`，工具就在没有 world 的情况下运行，什么也不记。lane A 在出厂 headless profile 上写了先红用例（A-432、A-531）：伪造的 provider 按它的声明被绑定，用 `local` 注册不抛错，`network: none` 的请求静默降级。

## 决定

- **保留 `local`。** 除非是 `createLocalWorldProvider` 造出的 provider，`register` 拒绝 id 为 `local` 的 provider，经一个模块私有的集合按对象身份识别，错误写明这个 id。local provider 的拷贝或仿品与其他 provider 一样被拒。
- **handle 按选择结果核对。** 只有 handle 写着选择所选中的 provider，并带着注册表按它所要的 spec 算出的摘要时，`bindingFor` 才绑定。任一项不符就什么也不绑，`refusalFor(agent)` 写明是哪一项不符。
- **该会话的调用由工具 guard 拒绝。** 注册表在工具运行时上登记一个 guard，每条派发路径在工具体之前都要经过它。该会话最近一次绑定没通过核对时，guard 拒绝这次调用，写明工具与没通过的那一项。用 guard，是因为它只收不放：没有哪个 `tools/pre-execute` 监听者能把它的拒绝变成放行。
- **没有 provider 承载得了的 world 记成声明过的降级。** 选择被拒时，调用不被拒：它在 `absent` 策略事实下运行，部署规则可以拒绝它，`readExecutionWorldFact` 按会话记一次 `action/world-unbound`，带上选择的拒绝。没通过核对的情况也这样记。

## 考虑过的其他做法

- **拒绝所要 world 没有 provider 承载得了的调用。** 在 `danger-full-access` 下声明了上限、而 subprocess 运行时守不住任何上限的机器上，选择会被拒；在派发处拒绝，会顶替 shell 工具的 `WorldCeilingsRefusedError`，后者写明模式与上限（P3-10，`tests/first100/fixtures/P3-10.world-ceiling.spec.ts`）。它还会拒绝不起进程的工具。
- **从 `bindingFor` 抛错。** 原生派发路径在追加调用之前读 world，在那里抛错会让这一轮以调度失败结束，而不是产出工具结果。
- **给 `ExecutionWorldFact` 加一个由强制执行点拒绝的新变体。** 这会改动策略词汇，而且策略拒绝携带的封闭 reason code 说不出是哪一项没通过。
- **把 `fenced` 也保留。** 契约点名的是 `local`；包的 README 把 `fenced` 记为已知限制。

## 后果

- 选中的 provider 返回的 handle 写着别的 provider，或摘要不是该 spec 的摘要时，会话不绑定 world，它的每次调用都在工具体运行之前被拒。工具结果写明没通过的那一项，会话记下 `action/world-unbound`。
- 要求没有 provider 承载得了的 world 的部署，工具照旧运行，会话现在会记下它为什么没有 world。因为别的原因没有 world 的会话，比如没有注册表、没有文件效应边界，或 provider 在 create 时拒绝（如 `danger-full-access`），不新记任何东西。
- guard 在风险闸之后运行，所以一个人可能被请求批准一次随后被 guard 拒绝的调用。
- 验证：A-432 与 A-531（`tests/first100/fixtures/P3-01.world-identity.composition.spec.ts`），`packages/execution/execution-world/tests/registry.spec.ts` 与 `world-fact.spec.ts`。
