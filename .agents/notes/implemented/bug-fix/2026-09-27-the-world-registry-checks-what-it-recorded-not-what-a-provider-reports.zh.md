# Agent Note：world 注册表核对它记下的，而不是 provider 事后自报的

Status: implemented

[English](2026-09-27-the-world-registry-checks-what-it-recorded-not-what-a-provider-reports.md) | 中文

## 问题

P3-01 对 B-666 的盲审发现，BLOCKED-316 条件 3 要的两项核对都能绕开。`register` 只读一次 provider 的 id，绑定时却拿 handle 与 provider 当时自报的 id 比，所以 provider 可以先用别的 id 注册，再把自己改名成 `local`。注册表把自己那份可变的 spec 交给 provider，`create` 之后才算摘要，所以 provider 可以清掉部署写的资源上限，报出改后 spec 的摘要，照样绑定；绑定里的上限也从这个被改过的对象读。盲审还发现工具 guard 的状态不单调：每次尝试先删掉该 agent 的拒绝，`await create` 之后才写新的，并发的派发可以在中间跑过去，之后一次早退的尝试也会抹掉已记下的不符。

## 决策

- `register` 记下 provider 注册时的 id，身份核对拿 handle 与这个记下的 id 比。
- `bindingFor` 解析出 spec，深冻结一份副本，并在选择之前算好它的摘要。每个 provider 只看到这份冻结的副本，handle 的摘要必须等于预先算好的那个，绑定的资源上限也从这份副本读。`create` 抛错，无论同步还是异步，都不造出 world。
- 同一 agent 的并发 `bindingFor` 共用一次尝试。一次尝试在结束时写一次拒绝；已记下的身份或摘要不符只由一次成功的绑定清掉，之后 `create` 失败或早退的尝试都不动它。

## 已考虑的替代方案

- **绑定时再查一次保留 id 表。** 它挡得住 provider 变成 `local` 或 `fenced`，挡不住它冒用另一个第三方 provider 的 id。
- **尝试开始就写一个「待定」拒绝，并把 `create` 失败当作拒绝。** 每个 `danger-full-access` 会话的 `create` 按设计都会被拒，走 `absent`，这样它的调用会全被拒绝；「待定」这一种还会改变 `action/world-unbound` 事件的载荷。

## 后果

- 改写所拿 spec 的 provider 现在会在注册表的调用里抛错；发生在选择阶段，这次绑定尝试失败，发生在 `create` 里，什么也不绑。
- 选择顺序，以及 `unavailable` 拒绝里写的 provider 名称，仍读各 provider 当前的 `id`。
- 本 note 部分取代 [world 注册表核对 world 由谁造出，没拿到所要 world 的会话会写明这一点](2026-09-26-the-world-registry-checks-who-built-a-world-and-declares-a-missing-one.zh.md)：身份核对、摘要核对，以及 guard 的拒绝何时写入。
- 验证：A-559（`tests/first100/fixtures/P3-01.world-identity.composition.spec.ts`）与 `packages/execution/execution-world/tests/registry.spec.ts`。
