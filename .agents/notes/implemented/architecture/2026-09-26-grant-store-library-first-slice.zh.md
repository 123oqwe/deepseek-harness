# Agent Note: 可复用的 grant 先是库，后才是挂载

Status: implemented

[English](2026-09-26-grant-store-library-first-slice.md) | 中文

## 问题

Epic P2-08 要一个可复用的 grant：作用于某个 actor、某个 capability 与某个 resource，携带金额、次数与时间窗口限额，标明 environment，会过期，可撤销，由 policy 断言匹配而不由模型自由解释的文本匹配，记录使用次数，且撤销能到达每个 worker 并默认 fail closed。

它的 Use 阶段消费一个审批接缝：越出所有 grant 限额的动作回到审批或拒绝（acceptance[1]），而那个接缝是 P2-07 的持久审批队列，尚未建成。此刻把 grant store 挂进出厂权限栈，要么耦合到一个不存在的接缝，要么把一个 opt-in 放进出厂默认，这两者包规则都禁止。第一片需要 grant 词汇及其决策先存在、先被跑到，而不牵涉上述任何一样。

## 决策

第一片是一个纯库 `@deepseek-ai/dsh-grant-store`，仅此而已。`src/types.ts` 放词汇；`src/match.ts` 校验草稿并匹配动作；`src/store.ts` 是进程内的 store 与 worker 视图。该包不注册任何 Cordis service、tool、prompt 或 session event，也没有任何 profile 挂载它，所以它还不在 SDK 运行时闭包内——只有当 Use 阶段随 P2-07 挂载它时，它才进入那个闭包。

匹配只读 grant 的断言与限额，从不读动作的 `justification`，因此模型自撰的「此动作已获批」的声明，或「不要放行」的指令，都改变不了决策（must[1]）。当两条 grant 覆盖同一动作时，取更严格的那条：落在更宽 grant 之内、更窄 grant 之外的动作，两条都不放行（acceptance[1]）；在库这一层这是一个 report 式的布尔放行/拒绝，而非 enforce 式的审批，与 `packages/policy` 的其余部分一致。

`validateGrantDraft` 拒两种形状，先查作用域再查过期，好让 store 无法持有它们：缺 actor、capability 或 resource 断言，或 resource 前缀为空因而覆盖所有 resource 的草稿，判 `GRANT_UNSCOPED`；过期缺失、非数值或非有限的草稿判 `GRANT_NO_EXPIRY`，故没有永久 grant。`issue` 跑同一套校验，并抛出携带该 code 的 `GrantError`，store 保持为空。grant 一经存入即不可变：一次计数的使用或一次撤销是替换其记录而非就地改，故早先取到的 list 仍是稳定快照。撤销推进 store 的 epoch；`GrantView` 在 epoch 变动时重读来源的 grant，读不到来源就什么都不放行，故不可达的 worker fail closed。

## 考虑过的替代方案

- **现在就挂载 store，背后放一个桩审批兜底。** 否决：它耦合到不存在的 P2-07 接缝，并把一个背后无真正 enforcement 的 opt-in 放进出厂默认。Use 阶段的挂载要等它所消费的那个接缝。
- **把 grant 匹配折进 `policy-enforcement`。** 否决：grant 匹配是一套独立词汇，正如 `risk-taxonomy` 独立于 `policy-engine`。policy 组已把 authority、grading 与 decision 作为只在 enforcement 点相遇的独立接缝，grant store 是第四个这样的接缝，而非对现有接缝的改动。
- **给 grant id 加 brand。** 推迟：第一片契约用普通 string id，也还没有不透明 id 要跨的 wire 或 process 边界。加 brand 属于第三片持久的跨 worker 来源。
- **让 worker 视图无缓存，每次授权都重读。** 否决，改用按 epoch 门控的重读：它模拟 acceptance[2] 所述的有界传播，且因为每次授权仍重查 epoch，撤销无论如何都会在下一次授权时被看到。

## 后果

- B-660 的十二条先红用例仅靠这个库就通过，无需组合启动。
- 第二片（Provider/Use）在 P2-07 落定后加 provider 并把 grant store 挂进权限栈；其默认必须 fail closed——空的或读不到的 store 回到审批或拒绝，绝不自动放行——也只有那时该包才进入 SDK 运行时闭包，受运行时闭包守卫约束。
- 第三片（Fault）把进程内来源换成持久的跨 worker 来源，覆盖 acceptance[2] 的撤销竞态与离线 worker 故障，以及各校验条款的最严格重叠与边界 property 测试。
