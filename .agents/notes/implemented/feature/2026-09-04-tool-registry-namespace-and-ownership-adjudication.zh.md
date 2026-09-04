# Agent Note：在真实工具注册表上裁决命名空间与所有权

Status: implemented

[English](2026-09-04-tool-registry-namespace-and-ownership-adjudication.md) | 中文

## 问题

Epic P1-09 的 Contract 阶段为 Service/Tool/Event 命名空间与所有权冲突检测构建了完整且经测试的纯函数面——`claimCapability`、`requestReplace`、`revokeByOwnershipToken`、`buildInventoryChain`、`isReservedNamespace`——而仓库中没有任何代码调用它们。在其自身包之外 grep `@deepseek-ai/dsh-plugin-ownership`，只得到散文：四个 README 把它当作包布局的先例引用。这些决策正确，但无法抵达。

有两条性质会让显而易见的接线变得不可信，二者都是**实测**而非推断得出的。

`ToolLayer` 的 `NamedEntries` 本来就会在任何重复注册时抛出 ``tool "<name>" is already registered``。在未修改的代码树上引导双插件冲突 fixture，已经以完全相同的错误中止。因此那条自然的验收用例——两个插件声明同一名称、期望引导失败——在零新增代码时就是绿的，并且在删除整个门之后依然是绿的。`lifecycle.ts` 还携带通往同一字符串的第二条路径：一条把它改写为 stop-then-run 配方的教学提示。

跨插件撤销此前根本无法表达。工具的销毁通过返回的闭包完成，没有任何接受名称或身份的 API，因此"插件 B 不能撤销插件 A 的工具"这一断言，断言的是 API 的缺席，而非任何强制。

## 决策

`ToolRuntime.register` 在每一次全局注册落地前进行裁决。

- **身份来自 Loader 条目，而非 fiber 名称。** `resolveOwner` 沿调用方的 fiber 链向上走，返回最内层外围 Loader 条目的模块说明符——即注册方稳定的磁盘身份。`Fiber.name` 走到最近的**具名 runtime**，是诊断用显示字符串；只有在完全没有 Loader 的树中它才作为兜底，而任何已引导的产品树都不是这种情况。
- **`declareOwner(identity)` 将 fiber 子树绑定到显式身份**，用于没有任何 Loader 条目为其命名的注册方。运行时动态定义的 Cordis 包正是它存在的理由。
- **`replace` 是唯一的覆盖路径。** 即使在 `ownership.allowReplace: true` 之下，对已被拥有名称的普通 `register` 仍是 `capability-collision` 拒绝。
- **`revokeOwned` 只接受 token。** 没有任何名称或身份参数可供调用方替换，因此跨插件撤销没有可尝试的面。
- **所有权记录与 effect 同生共死。** 记账发生在 `layers.effect` 的 action 及其 undo 之内，这正是让本项 "effects after unload = 0" 对记录（而不仅仅对工具）成立的原因。被一次合法替换取代的记录会保留，以便 Inventory 仍能展示链条；已卸载插件的记录则不会。

`packages/extensions/cordis-host-runner/src/guard.ts` 拒绝动态包在 `dsh.*` 内调用 `ctx.provide`/`ctx.on`/`ctx.once`。该 façade 是 Service 或 Event 注册在抵达 Cordis 之前被裁决的唯一非 vendored 位置。

**动态包的身份属于 runner，而非它自己。** `guardedPlugin` 在 host 半的 `apply` 运行前调用 `declareOwner(pluginId)`，因此注册被归属到由 `startHostHalf` 向下穿入的 runner `CordisDynamicPluginId`。两种兜底方案对本场景都是错的，并据此被否决：`Fiber.name` 解析到模型在自己源码中写下的 `name`，一个包可以声明真实插件的包名并继承其地位；而外围 Loader 条目是共享的 `cordis-dynamic` group——所有动态半都挂在其下——会把它们坍缩为同一个拥有者，令动态对动态的冲突无法被检出。**身份绝不能绑定到主体自身可控的东西上。**

**所有权拒绝必须重新教授它所挤掉的消息。** 有了各自独立的身份，动态包与不同拥有者冲突时会先被所有权门拒绝，工具注册表的重复错误不再触发，于是 `lifecycle.ts` 的 stop-then-run 配方——模型面对该冲突的实际操作指引——不再抵达模型。现在该配方在 `capability-collision` 上与在 `already registered` 上一并教授；两条消息描述的是同一处境（同包重跑，与不同拥有者），且需要同样的修复。捕获这次丢失的正是 `composition.spec.ts` 既有的 "names the replace recipe" 用例，而移除新增分支的变异会让它重新变红。

`packages/host/plugin-inventory/src/index.ts` 新增 `buildToolOwnershipChain(ctx)`，与其旁边的 `buildPluginPermissionStates` 一样是普通导出。

**scoped 注册的裁决方式不同，而仓库自带的测试抓住了初稿的错误。** 冲突裁决与所有权记录仅适用于全局注册：scoped 工具遮蔽全局名称正是 `agent.ctx` 注册的**用途**，初稿把它当作冲突拒绝，被本包既有的 `scoped.spec.ts` 抓住。保留命名空间规则仍适用于每一个 scope，否则 `dsh.*` 将可从任意 agent scope 被声明。

**保留命名空间已被强制，但尚无实例。** 仓库中没有任何工具名、服务键或事件名包含 `.`，因此今天没有任何东西声明冲突的 `dsh.*` 命名空间。那些用例证明门会拒绝；它们没有捕获任何既有冲突，也不应被如此解读。

## 具名残留

**静态来源的 Service 与 Event 注册在任何地方都未设门。** `ctx.provide` 与 `ctx.on` 实现于 `vendor/cordis`；为其设门属于 vendored 改动，而 Trust Kernel 边界要求其排在尚未落地的 `Fiber` 修复之后。因此 must[0] 的强制范围是：Tool 覆盖全部来源，Service/Event 仅覆盖动态来源。对该条款采取仅限 Tool 的更窄解读会让此残留消失，该解读被拒绝，正因为它是消除障碍的那一种解读。

（第二条残留——动态包的注册落到模型撰写的 `Fiber.name` 上——已在本次同一改动中关闭，见下文。）

## 考虑过的替代方案

**处处从 `Fiber.name` 推导身份。** 否决：它是诊断显示名，而对动态包更是由模型撰写，一个包可以声明真实插件的包名并继承其地位。

**用完整的存活注册列表调用 `claimCapability`。** 否决：其冲突检查同样会拒绝同一身份的重复注册，这会吞掉既有的重复注册错误及其 per-agent 变体指引。只有由**其他**身份持有的注册才作为 contested 传入，同一身份的重复注册落回 layer。

**仅以引导失败断言冲突用例。** 经实测否决为空洞：未修改的代码树本就会让该引导失败。

## 后果

`gen-cordis-catalog` 在 `CapabilityRegistration`、`OwnershipToken`、`RevocationResult` 被分类之前拒绝新的服务方法；它们现为 `TYPE_LINK_EXEMPTIONS` 条目，指明 `plugin-ownership` 的 README 为文档所有者。

**Cordis Loader 会回写它所引导的配置。** `apply` 抛出的条目会被持久化为 `disabled: true`。本项有两个组合被设计为失败，因此早期运行**修改了签入的 fixture**，而后续运行读到的是失败条目已被关闭的树——先产生一次毫无意义的绿，随后是稳定的红。现在每次引导都会把 fixture 目录复制到仓库**内部**一个被 git 忽略的 `tmp/` 下；在仓库之外，workspace 包无法解析。任何把 `runLoaderSmoke` 指向仓库内、其条目可能失败的配置的测试，都存在这个问题。
