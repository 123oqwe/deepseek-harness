# Agent Note: Plugin Manifest v2 real enforcement at profile boot

Status: implemented

[English](2026-09-02-plugin-manifest-real-enforcement-at-profile-boot.md) | 中文

## 问题

Epic P1-01 的 Contract 与 Provider 阶段构建了一套完整、经过测试的 Plugin Manifest v2 纯函数表面——schema 校验、通配检测、旧版 `dsh.bundle` 分类,以及 `compareDeclaredToObserved`/`decidePluginTrust`——但代码库中没有任何地方真正调用它们。没有 CLI 读取夹具,没有代码走查活跃 Cordis `Context` 来构建这些函数所比对的 `ObservedPluginCapabilities`,也没有启动路径对 `'quarantined'` 或被拒绝的决策采取行动。acceptance[0] 要求缺少 manifest、声明/观察不一致,或申请通配权限时,在真实 profile 启动处安装失败或进入明确 quarantine,而不只是返回一个无人读取的值。

Provider 阶段的独立 Reviewer 另外发现,`compareDeclaredToObserved` 只按能力身份(名字)比对,从不比对字段内容,并把这一点记为非阻塞的已知限制——恰恰是因为当时还没有真实的强制执行让它变得重要(BLOCKED-027)。该裁定要求 Usage 阶段的 Reviewer 针对本阶段构建的真实强制执行设计重新审视这个问题,而不是默默地再次披露它。

## 决策

真实的观察、准入与 quarantine 被接入了真实的 profile 启动,首尾贯通:

- **`packages/host/plugin-inventory/src/index.ts`** 新增了本代码库第一个针对按插件注册的真实活跃 `Context` 走查:`buildObservedPluginCapabilities(ctx, rootFiber)` 走查一个插件条目的 Fiber 子树——用全局 Cordis `ReflectService` store(按 `Fiber.uid` 而非 `===` 过滤:通过 `Loader` `Entry.fiber` 拿到的 `Fiber` 和通过 `ReflectService` `Impl` 拿到的 `Fiber`,即便指向同一个活跃 fiber,也不总是同一个对象)得到 `ctxKeys`,用 `Fiber.getEffects()` 标签解析得到 `toolNames`/`skillNames`/`eventNames`,用一个活跃 MCP-client 条目已解析的 `config.serverName` 得到 `mcpServerNames`。`buildPluginPermissionStates(ctx, options)` 把它与每个条目自己的 `package.json` `dsh` 字段(`classifyPluginDeclaration`)组合,并对 `'manifest-v2'` 声明给出真实的 `compareDeclaredToObserved`/`decidePluginTrust` 结果。
- **`packages/plugin/plugin-manifest/src/index.ts`** 新增 `evaluatePreMountAdmission(declaration, production)`,真实的预挂载策略:`production: false` 无条件接纳(每个既有 profile 照旧启动);`true` 会在任何代码运行之前,拒绝 `'missing'`/`'legacy-untrusted'` 声明或申请通配权限的 manifest。
- **`packages/boot/app-boot/src/profile.ts`** 新增 `readPluginDeclaration`/`partitionProfileLayersByAdmission`,从每个组合包层真实的磁盘 `package.json` 分类并判定准入。
- **`apps/cli/src/profile-boot.ts`** 把两半都接入真实启动流程:`composeProfile`(现已导出)在任何 patch 到达 `boot()` 之前调用 `partitionProfileLayersByAdmission`,因此被拒绝层的 patch 永不会挂载——这是最强形式的强制执行,因为该插件的代码根本不会运行。`boot()` 稳定后,`applyPostMountPluginEnforcement(ctx, production, admittedLayerNames)` 调用 `buildPluginPermissionStates`,并销毁任何被 `decidePluginTrust` 判为 `'quarantined'` 的条目的活跃 Cordis fiber——是真的销毁,而不只是判定。两者都由 `resolvePluginEnforcementMode(process.env.DSH_PLUGIN_MANIFEST_ENFORCEMENT)` 把关,其校验方式对照 `resolveFeatureGateEnvOverride` 自身的 fail-loud 风格(必须恰好是 `'enforce'` 或未设置,其他值会抛错)。
- **`apps/cli/src/plugin.ts`** 新增 `runPluginVerify(fixturePath)`,即 registry 自己的 `pnpm plugin:verify <fixture>`——把夹具读作原始 `dsh` 字段、分类,并以退出码 0/1 报告 `evaluatePreMountAdmission` 的真实决策。通过新的顶层 `plugin-verify` 命令接入(`apps/cli/src/args.ts`、`bin.ts`),而非 `plugin` 子命令:Commander 即便对被调用的子命令,也会强制父命令自己的 `requiredOption`(`plugin --profile`),而这项检查根本不需要 profile。`package.json` 新增 `"plugin:verify": "node --import tsx/esm apps/cli/src/bin.ts plugin-verify"`。

**强制执行默认关闭。** 本安装中尚无任何已发行的组合包声明 Manifest v2,因此若对一个真实 profile 设置 `DSH_PLUGIN_MANIFEST_ENFORCEMENT=enforce`,今天会拒绝该 profile 的每一个组合包。该开关是真实的、对夹具测试过的(`packages/plugin/plugin-manifest/tests/fixtures/*.json`,包括三个新的恶意夹具——`malicious-schema-spoof.json`、`malicious-mcp-elicitation.json`、`malicious-skill-secret-request.json`——以及 `apps/cli/tests/plugin-enforcement.spec.ts` 中真实的启动级证明),但尚无任何已发行 profile 能通过它;那次迁移(给 `dsh-base` 及其依赖项加上真实 manifest)是独立的、后续工作。

**BLOCKED-027 重新裁决:予以确认,而非再次延后。** 真正构建 `buildObservedPluginCapabilities` 具体确认了:本代码库中没有任何活跃注册携带 `sideEffectClass`/`authAudience`/`allowedDestinations`/`dataClassification`——`ToolDefinition`(`packages/core/tools`)没有、Cordis 服务 `Impl`(`vendor/cordis/src/reflect.ts`)没有、MCP-client 的 `Fiber.config` 没有、`SkillDefinition`(`packages/skill/skill`)也没有。字段内容比对会去比对一个在观察侧今天结构上根本不存在的字段——这不是更弱的检查,而是空洞的检查。这个真实的洞无法在本 epic 的三个包内部补上;需要一次单独的、更大的改动,把 effect 元数据贯穿到整个仓库的每一个 tool/skill/MCP/event 注册调用点。因此按身份比对就是真实的 Usage 阶段设计,而不是一个占位符。

**Tool/skill 的 effect 标签获得了注册名。** `packages/core/tools/src/index.ts` 的 `ToolRuntime.register` 与 `packages/skill/skill/src/index.ts` 的 `Skills.register` 此前各自用固定标签调用 `ctx.effect(fn, label)`(`'tools.register()'`/`'skills.register()'`),不同于 `ctx.provide(name)`/`ctx.on(name)` 自己已有的、把名字嵌进标签的惯例。两处 effect 标签现在都参数化了(`` `tools.register(${JSON.stringify(name)})` ``)——一次最小、行为保持不变、遵循先例的改动,也是在不引入更大的 owner 追踪机制的前提下,把一个已注册的 tool/skill 名字归属回其所属 fiber 的唯一办法。这两个文件在 owner map 中都没有条目(共享/无主),因此不存在 owner 冲突。

**`pluginInventory` 没有权限状态的 Remote 方法。** 曾尝试把 `buildPluginPermissionStates` 作为 `PluginInventoryGateway` 上的 `@Remote('permissions')` 方法,但在一次真实构建失败后回退:typert 的 Zod schema 生成器无法序列化 `PluginManifestV2` 的非空元组字段(`readonly [X, ...X[]]`,例如 `CapabilityEffectDeclaration.authAudience`)——`TypertEmitError: tuple rest element must retain an array type`。它仍是一个纯函数;`apps/cli` 直接调用它,同时满足真实的 CLI 展示与启动时强制执行,无需 Remote 界面即可满足 acceptance[1]。

## 已考虑的替代方案

**在构建 `ObservedPluginCapabilities` 时按 `===` 比较 `Fiber` 对象。** 在一次真实启动中失败后被否决:通过 `Loader` 的 `Entry.fiber` 拿到的 `Fiber`,与通过 `ReflectService` 的 `Impl.fiber` 拿到的同一个活跃 fiber,并非引用相等,已通过实测确认(`impl.fiber === entry.fiber` 为 `false`,`impl.fiber.uid === entry.fiber.uid` 为 `true`)。`Fiber.uid` 才是正确、稳定的身份。

**任何一个被拒绝的组合包层都导致整个 profile 启动失败,而非只排除那一层。** 未采用:acceptance[0] 的“安装失败或进入明确 quarantine”读起来是两种可接受的结果,而只排除被拒绝层的 patch,既是对该插件而言真实的“安装失败”,又能让 profile 的其余部分继续运行——是更友好、也更贴合字面“quarantine”的理解,并且产生一个真实的、可断言的启动时差异(被拒绝插件的 Loader 条目永不出现),而非一次全有或全无的崩溃。

**现在就把 effect 元数据(`sideEffectClass` 等)贯穿到每一个注册调用点,以彻底补上 BLOCKED-027 的洞。** 本切片未采纳:牵涉 `packages/core/tools`、`packages/skill/skill`、`packages/mcp/mcp-client`,以及仓库中其他每一个 tool/skill/MCP/event 注册点——是一个史诗级的工作量与影响范围,不是一次 Usage 阶段的接线工作。重新裁决对此给出了具体记录,而不是默默地把披露原样继续下去。

**把 `buildPluginPermissionStates` 暴露为 `pluginInventory` 的 Remote 方法。** 在一次真实、可复现的构建失败(typert 无法序列化 `PluginManifestV2` 的非空元组)后回退。修复 typert 生成器,或设计一个对序列化友好的 `PluginPermissionState` 投影,是与本 epic 真实强制执行工作相独立的另一个课题。

## 后果

当 `DSH_PLUGIN_MANIFEST_ENFORCEMENT=enforce` 时,一个缺少/使用旧版 manifest 的插件、一个申请通配权限的 manifest,或一个声明/观察能力不一致的插件,现在会在真实 profile 启动处被真正拒绝或 quarantine——`apps/cli/tests/plugin-enforcement.spec.ts` 通过真实的 `boot()` 调用(而非模拟的 Loader 状态)首尾证明了这一点。`pnpm plugin:verify <fixture>` 是一个真实、可用的命令,对 registry 提及的每一个夹具都成立,包括三个新的恶意夹具。工具名冲突——第二个插件试图注册第一个插件已占有的名字——在本阶段之前就已经是 `packages/core/tools` 中真实、经测试的强制执行(`ToolRuntime.register` 的 `NamedEntries.insert` 在重名时抛错);这里不重复该覆盖。

按身份比对而不比对字段内容,现在是一个已确认、有证据支撑的设计决策,而非一条被搁置未审视的既有披露:本代码库中没有任何活跃注册暴露字段内容比对所需要的那些字段。在一次独立的、后续的迁移让至少一个已发行的组合包拥有真实 Manifest v2 之前,强制执行在每一个真实部署中默认关闭——这一点在两个包的 README 中都有披露,而不是被藏在这个开关本身的存在背后。
