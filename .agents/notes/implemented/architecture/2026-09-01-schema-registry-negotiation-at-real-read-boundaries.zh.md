# Agent Note: 在真实读取边界接入 Schema Registry 协商

Status: implemented

[English](2026-09-01-schema-registry-negotiation-at-real-read-boundaries.md) | 中文

## 问题

`@deepseek-ai/dsh-schema-registry`（Epic P0-06 的 C 格与 P 格）已经搭建了真实的 `registerSchema`/`evolveSchema`/`negotiateSchema`/`getSchema`/`listSchemas` 表面，并把每一个 session-event 与 sdk-protocol schema 都以 1.0 版本引导注册，但代码库中没有任何地方在真实读取边界调用 `negotiateSchema`/`getSchema` —— registry 建成之后完全无人使用。Epic P0-06 的 must[4] 要求 session replay、SDK initialize、plugin load 在使用前协商/校验 schema；acceptance[1] 要求不兼容客户端得到机器可读错误、不发生静默字段丢失。

按 wave-map 字面声明的文件接线 session-replay 边界（`packages/core/session/src/types.ts`）并不可构建：`@deepseek-ai/dsh-schema-registry` 已经依赖 `@deepseek-ai/dsh-session`（真实值导入 —— `KNOWN_SESSION_EVENT_TYPES`，在模块求值期被消费用于引导 session-event schema 注册）。反向再加一条依赖边会形成 ESM 导入环；已通过实际尝试验证：`dsh-session` 变得不可加载（`TypeError: KNOWN_SESSION_EVENT_TYPES is not iterable`）。另外，`core/session/src/types.ts` 是纯类型模块，本身根本不含任何读取边界可接线——真实的 session-replay 读取路径实际位于 `@deepseek-ai/dsh-session-persistence-jsonl`。

## 决策

真实的 `negotiateSchema()` 调用被接入到实际的读取边界，而非 wave-map 字面猜测的文件；偏离按 manifest patch 记录（`tests/first100/adjudication.json#deliverablePathPatches`，属 BLOCKED-012 一类）：

- **Session replay**：`packages/session/session-persistence-jsonl/src/format.ts` 的 `SessionLogScanner.consumeEventLine`，紧跟在 `JSON.parse` 之后、`decodeStorageRecord` 之前。未注册的事件类型会被跳过（那是既有 `ignorable`/`known-event-types` 机制的管辖范围，不属于 registry——按构造，`KNOWN_SESSION_EVENT_TYPES` 的每个成员都已注册，因此跳过分支永远不会放行一个"已注册但不兼容"的载荷）。已注册类型若 major 不兼容，直接抛出 `SchemaCompatibilityError`，不落入任何容忍性的损坏后缀启发式处理。
- **SDK initialize**：`packages/sdk/server/src/server.ts` 的 `HarnessSdkJsonRpcServer.initialize()`，作为其前四条语句，先于任何其他握手校验。
- **Settings load**：`packages/settings/settings/src/index.ts` 的 `SettingsProvider.register()`（冷启动）与 `.publish()`（热重载），先于 owner 自身的 schemastery `resolve()`。之所以接在这里而非 `packages/settings/settings/src/types.ts`，是因为那个文件只声明 wire-view/投影类型——真正"使用前协商"的位置是 provider 的运行期读取路径，而非类型声明。每个 settings 命名空间在 `register()` 时自行注册自己的 `settings:${ns}` schema（不存在才注册；命名空间会在进程生命周期内反复挂载/卸载）。

两个替代路径（`session-persistence-jsonl/src/format.ts`、`settings/settings/src/index.ts`）均不在 `spec/first100-owner-map.json` 机械追踪的文件→epic 归属表中——属共享基础设施，不被任何 epic 独占，因此该偏离零 owner 冲突（BLOCKED-012 条件二）。

must[4] 的 "plugin load" 与 wave-map 的 "settings load" 被视为同一边界：`SettingsProvider.register()` 由插件自身在 Cordis 加载期间调用，且 fiber 作用域绑定该插件生命周期，因此该检查确实发生在 plugin-load 时刻。它校验的是插件的 settings 分区叶子对象，而非插件 manifest/ABI schema——registry 目前尚无任何插件-manifest 叶子对象（那是 P1-01/P1-08 的未来范围）。

## 已考虑但未采纳的方案

**直接在 `core/session` 接线 session-replay 协商。** 否决：会形成真实的 ESM 环（已证明，非假设），且字面声明的文件本身也不含任何可接线的读取边界。

**让 `dsh-session` 用惰性/动态 import 包一层来绕开环。** 未采纳：这是为绕开依赖方向问题而增加的间接层，更诚实的修法是接在本就合法依赖两者的那一层（`session-persistence-jsonl` 已经同时依赖 `dsh-session` 与 `dsh-schema-registry`，不会形成环）。

**把每一个未注册的 session-event 类型都当作协商失败。** 否决：这是第一版实现中的真实设计缺陷，而非"更严格更安全"的选择——它会抢占既有 `ignorable`/legacy-type 机制自己的管辖范围，把当前机制本已正确处理的会话错误地拒绝掉。

## 后果

三个真实的、产品可见的边界现在会在信任载荷之前协商 schema 版本；major 不兼容会以结构化 `SchemaCompatibilityError`（schemaId、遇到版本/已注册版本）失败，绝不静默。Registry 针对 `SESSION_FORMAT_VERSION` 的既定范围边界（BLOCKED-008：只管叶子对象版本，绝不管容器格式）保持完整——没有任何协商调用引用或包装它，`packages/core/session/src/repair.ts`/`known-event-types.ts` 均未被改动。

wave-map 按 epic 声明的 `files[]` 并非总能字面构建；`tests/first100/adjudication.json#deliverablePathPatches` 新增了可选的 `epic` 字段，使一个 epic 能在同一 stage 内携带多条 patch（BLOCKED-012），而非 BLOCKED-001 引入的原始"每 epic 一条 patch"形态。
