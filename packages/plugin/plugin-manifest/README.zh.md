---
description: "Plugin Manifest v2 的类型表面、纯校验逻辑与声明/实际观察比对,供需要确切了解插件必须声明什么、schema/通配检查如何工作、quarantine 决策如何推导的用户与维护者阅读。"
kind: "package-library"
---

# @deepseek-ai/dsh-plugin-manifest

[English](README.md) | 中文

## 概述

`dsh-plugin-manifest` 固定了 Epic P1-01 Plugin Manifest v2 的类型表面与纯校验逻辑:插件包在 `package.json` 的 `dsh` 字段下携带的 `dsh.manifestVersion=2` 形态(must[0])——services、tools、skills、MCP servers/resources/prompts、events、filesystem、network、process、secrets、UI surfaces、data stores、migrations、执行模式与兼容性。每个 Tool/MCP capability,以及每个远程 Skill/MCP Provider,都声明 side-effect class、auth audience、allowed destinations 与 data classification(must[1]/acceptance[3])。本包同时兼容读取既有的 `dsh.bundle` 格式,并始终标记为 `legacy-untrusted`(must[3]),并检测通配权限申请(acceptance[0])。

`src/index.ts` 现在把每个 Contract 阶段运行时函数与类型一并 re-export,并新增了本包的 Provider 阶段逻辑:`compareDeclaredToObserved` 把一份已校验 manifest 的声明能力,与插件实际注册进活跃 Cordis `Context` 的内容做比对;`decidePluginTrust` 把该比对结果转化为 acceptance[0] 所要求的 quarantine 决策。Usage 阶段(Epic P1-01.U)新增了 `evaluatePreMountAdmission`——`packages/boot/app-boot/src/profile.ts` 的 `partitionProfileLayersByAdmission` 与 `apps/cli/src/plugin.ts` 的 `pnpm plugin:verify <fixture>` 都调用的真实预挂载策略;`packages/host/plugin-inventory` 现在从活跃 Cordis `Context` 构建真实的 `ObservedPluginCapabilities` 值(`buildObservedPluginCapabilities`),`apps/cli/src/profile-boot.ts` 把两半都接入真实 profile 启动——被拒绝的组合包层的 patch 永不会到达 `boot()`,而挂载后被判定为 `'quarantined'` 的条目会被销毁其 fiber。参见[已知限制与延后工作](#known-limitations-and-deferred-work)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

对 `package.json` 的 `dsh` 字段分类并按 schema 校验一份 manifest——从包根或文档记载的 `/validate` 子路径导入均可:

```ts
import { classifyPluginDeclaration, validatePluginManifestV2, detectWildcardPermissions } from '@deepseek-ai/dsh-plugin-manifest'

declare const dshField: unknown // package.json's parsed "dsh" field

const declaration = classifyPluginDeclaration(dshField)
// declaration.kind is 'manifest-v2' | 'legacy-untrusted' | 'missing'

const result = validatePluginManifestV2(dshField)
if (result.valid) {
  const wildcards = detectWildcardPermissions(result.manifest)
  // wildcards is non-empty for a manifest requesting '*', '**', or '/' as a destination pattern
}
```

把一份已校验 manifest 的声明与插件实际注册的内容做比对,并从结果推导 quarantine 决策:

```ts
import { compareDeclaredToObserved, decidePluginTrust, type ObservedPluginCapabilities } from '@deepseek-ai/dsh-plugin-manifest'

declare const observed: ObservedPluginCapabilities // built by a later stage from a live Cordis Context

if (result.valid) {
  const comparison = compareDeclaredToObserved(result.manifest, observed)
  // comparison.mismatches: capability names declared but never registered, or registered but never declared
  // comparison.wildcardFindings: same wildcard findings detectWildcardPermissions already reports
  const trust = decidePluginTrust(comparison)
  // trust is 'active' when comparison has neither, 'quarantined' otherwise
}
```

在任何代码运行之前,判断一个已分类的声明是否被生产启动接纳:

```ts
import { evaluatePreMountAdmission } from '@deepseek-ai/dsh-plugin-manifest'

const admission = evaluatePreMountAdmission(declaration, /* production */ true)
if (!admission.admitted) {
  // admission.reason is 'missing-manifest' | 'legacy-untrusted' | 'wildcard-permission'
  // admission.wildcardFindings is non-empty only for the wildcard-permission reason
}
```

每个导出都是对已算好数据的纯函数——没有一个会读文件、启动进程、import 它所校验的插件包本身,或构造 Cordis `Context`。本包不为 `PluginManifestV2` 导出任何构造函数:插件作者把 manifest 写成自己 `package.json` 里的字面 JSON,本包只负责读取、检查与比对它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节说明本包背后的设计决策;可观察的类型契约已在[使用本包](#use-this-package)中完整覆盖。

### 设计哲学

- **对 `dsh.bundle`/`dsh.profile` 是附加,而非替代。** `package.json` 的 `dsh` 字段已经携带 `dsh.profile`(一个 profile 的组合包列表)和 `dsh.bundle`(组合包的 `cordis.patch.yml` 指针,参见 [`docs/architecture.md#profiles-and-bundles`](../../../docs/architecture.zh.md#profiles-and-bundles))。`PluginManifestV2` 是第三种形态,`dsh.manifestVersion === 2`;一个包可以在拥有组合包 patch 的同时携带 manifest。
- **必须是静态数据,而非生成的代码(must[2])。** `src/types.ts` 中的每个类型都描述一个纯 JSON 可序列化的值——没有函数类型字段、没有方法、没有类实例——`src/validate.ts` 的 `assertJsonSerializable` 会拒绝携带函数、`symbol`,或数组内嵌 `undefined` 的值:这三种情况都无法在 `JSON.parse` 中幸存,它们的出现证明该值是通过执行代码构建的,而非解析文件得到的。
- **旧版 `dsh.bundle` 始终读作 `legacy-untrusted`(must[3])。** 旧格式本身不声明任何能力——只有一个 patch 文件指针——因此从结构上就没有可信任的声明权限面。`isDeniedInProductionByDefault` 对 `'legacy-untrusted'` 与 `'missing'` 声明均拒绝。
- **扎根于本仓库既有词汇,而非凭空发明。** `ExecutionMode` 对照 `@deepseek-ai/dsh-code-runtime` 的 `CodeRuntime.isolation` 已知取值;`EventCapabilityDeclaration.mode` 直接复用 `@deepseek-ai/cordis` 自身的 `DispatchMode`;`McpServerDeclaration` 的 transport 与 `serverName` 语法对照 `@deepseek-ai/dsh-mcp-client` 真实的 `Config`;`SkillCapabilityDeclaration.name` 对照 `@deepseek-ai/dsh-skill` 真实的 `SKILL_NAME` 语法。`sideEffectClass`、`authAudience`、`allowedDestinations` 与 `dataClassification` 在本仓库没有先例——`src/types.ts` 自身的文档注释记录了本切片所采纳的解释。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | `PluginManifestV2` 类型表面:每个 must[0] 字段、must[1] 的 Tool/MCP 副作用字段,以及 `PluginDeclaration`/`LegacyBundleDeclaration` 分类类型 |
| [`src/validate.ts`](src/validate.ts) | 纯 schema 校验(`validatePluginManifestV2`)、静态数据检查(`assertJsonSerializable`)、通配权限检测(`detectWildcardPermissions`),以及旧版 `dsh.bundle` 兼容读取(`parseLegacyBundleDeclaration`、`classifyPluginDeclaration`) |
| [`src/index.ts`](src/index.ts) | 本包真正的运行时入口:re-export 每个 `./types.ts` 类型与 `./validate.ts` 函数,新增 `ObservedPluginCapabilities`、`compareDeclaredToObserved` 与 `decidePluginTrust`(声明/实际观察比对与 quarantine 决策),以及 `evaluatePreMountAdmission`(Usage 阶段的真实预挂载策略) |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴随检查:explained-empty——本切片尚不存在已构造的 manifest 值或安装器 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`docs/plugins/manifest-v2.md`](../../../docs/plugins/manifest-v2.zh.md)——manifest 格式的用户侧文档。
- [`spec/capability-manifest.schema.json`](../../../spec/capability-manifest.schema.json)——与本包类型表面逐字段对应的 JSON Schema(draft 2020-12)。
- [`tests/manifest.spec.ts`](tests/manifest.spec.ts)——Contract 阶段的证明,包括本包 TypeScript 校验器与 JSON Schema 文档(ajv)在 golden fixture 上的一致性。
- [`tests/manifest.provider.spec.ts`](tests/manifest.provider.spec.ts)——`compareDeclaredToObserved`/`decidePluginTrust` 的 Provider 阶段证明。
- [`docs/architecture.md#profiles-and-bundles`](../../../docs/architecture.zh.md#profiles-and-bundles)——本包 manifest 所附加的既有 `dsh.bundle`/`dsh.profile` 词汇。

-----

<a id="model-experience"></a>
## 模型体验

无,本包仅导出类型与纯校验函数,不注册任何模型可见内容。

#### KV 缓存影响

这里的内容不会进入模型请求,因此不影响 provider 缓存复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **真实的读取器/CLI/启动接线现已存在**——`apps/cli/src/plugin.ts` 的 `pnpm plugin:verify <fixture>`、`apps/cli/src/profile-boot.ts` 的 `composeProfile`/`applyPostMountPluginEnforcement`,以及 `packages/host/plugin-inventory` 的 `buildObservedPluginCapabilities`/`buildPluginPermissionStates`,现在都会为真实安装与 profile 启动调用 `classifyPluginDeclaration`/`evaluatePreMountAdmission`/`compareDeclaredToObserved`/`decidePluginTrust`(Epic P1-01.U)。本包自身仍不执行任何 I/O、不构造 `Context`——这条边界是刻意保留、未曾改变的;活跃 `Context` 走查请参见 `packages/host/plugin-inventory` 自己的 README。
- **`decidePluginTrust` 的 quarantine 现在被真正强制执行**——`apps/cli/src/profile-boot.ts` 的 `applyPostMountPluginEnforcement` 会在启动后销毁一个 `'quarantined'` 条目的活跃 Cordis fiber;`evaluatePreMountAdmission`(由 `composeProfile` 在 `boot()` 挂载任何内容之前调用)会在预挂载阶段就拒绝 `'missing'`/`'legacy-untrusted'` 声明或申请通配权限的 manifest,与 `isDeniedInProductionByDefault` 自身的轴线一致。强制执行按启动逐次通过 `DSH_PLUGIN_MANIFEST_ENFORCEMENT=enforce` 选择性开启(`apps/cli/src/profile-boot.ts` 的 `resolvePluginEnforcementMode`)——默认关闭,因为本安装中尚无任何已发行的组合包声明 Manifest v2;若对一个真实 profile 打开它,今天会拒绝该 profile 的每一个组合包。这是一个真实的、已披露的迁移缺口,而非走过场:机制是真实且对夹具测试过的,只是尚无任何已发行 profile 能通过它。与 P0-02 的 Trust Kernel(默认安全/开启)相反,该开关默认关闭;路线图应明确跟踪在 `dsh-base` 发行真实 Manifest v2 之后翻转此默认值,以免这种不对称因遗漏而变成永久状态。
- **`compareDeclaredToObserved` 按能力身份(名字)比对,不比对字段内容,且只比对顶层(BLOCKED-027,已在 U 阶段重新审视,裁定为真实设计)**——一个工具在声明与观察中同名,但 `sideEffectClass`/`authAudience`/`allowedDestinations`/`dataClassification` 发生漂移,不会产生任何 mismatch;`McpServerDeclaration` 嵌套的 `resources`/`prompts` 从不参与比对,只比对顶层的 server 名字。U 阶段的具体确认:`packages/host/plugin-inventory` 真实的 `buildObservedPluginCapabilities`——构建自 `Fiber.getEffects()` 标签与 Cordis 全局 `ReflectService` store,是本代码库暴露的唯一真实的按插件注册信号——无法从任何活跃注册中恢复这些字段(`ToolDefinition`、一个服务 `Impl`、一个 MCP-client 的 `Fiber.config`、一个 `SkillDefinition` 都不携带它们中的任何一个)。因此字段内容比对会去比对一个在观察侧结构上根本不存在的字段,这不是更弱的检查,而是空洞的检查。要真正补上这个洞,需要一次单独的、更大的改动,把 effect 元数据贯穿到整个仓库的每一个 tool/skill/MCP/event 注册调用点——超出本包与本阶段的范围,是另一个史诗级的工作量,而不是对原始披露的默默延续。
- **quarantine 目前对两个方向的不一致一视同仁**——观察到但未声明的注册,与已声明但从未注册的能力,现在都会触发 `'quarantined'`;registry 原文"声明与实际注册不一致"读起来不分方向,但一个合法的惰性/条件注册可能与后一种情况长得一模一样。在后续阶段把真实强制策略叠加到这个决策之上之前,这个不对称性值得一次审慎的裁决。
- **`detectWildcardPermissions` 只识别精确的 `'*'`、`'**'` 与 `'/'` 模式**——一个实质上过宽但并非字面等于这三种字符串之一的模式(例如一个不必要地宽泛但非最大化的 glob)不会被标记。更细粒度的过度授权启发式是后续阶段(如果有)的工作。
- **`sideEffectClass` 是单一声明标签,而非集合**——一个具有多种副作用(例如同时有 `'write'` 与 `'network'`)的 capability 只声明适用的单个最高影响等级;本 schema 不进一步拆解复合副作用。
- **`assertJsonSerializable` 只在校验那一刻检查取值,不证明不可变性**——一个字段由 getter 支撑的 manifest,可以在一次读取时通过校验,而后续读取同一个 `result.manifest` 引用(未做克隆)时返回不同内容。文档约定的调用方式(`JSON.parse` 的输出,结构上不可能产出 getter)在实践中规避了这一点,但在公开 API 接受 `unknown` 的地方,这一约定并未被类型系统强制。
- **JSON Schema 并未像 `validate.ts` 那样把每个对象都关闭到禁止未知属性**——一个携带额外未声明属性的对象,目前会让 `spec/capability-manifest.schema.json` 的 `ajv` 校验失败,却能通过 `validatePluginManifestV2`;上文"与 TS 类型逐字段镜像"的说法,对已声明字段成立,对两个校验器一致拒绝未声明字段这一点尚不成立。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文:未决问题与尚未确定的方向。它明确不具权威性——已交付的行为与限制记录在上述各节与包代码中。

无。

</details>
