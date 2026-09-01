---
description: "面向 Epic P0-05 Shadow/Enforce 功能门禁的 Contract 阶段类型表面：统一状态、逐门禁生命周期元数据、settings 命名空间互操作、override 链形状，以及 shadow/legacy 决策 diff 记录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-feature-gates

[English](README.md) | 中文

## 概述

`dsh-feature-gates` 固化了 Epic P0-05（面向主要能力的 Shadow/Enforce 功能门禁）的 Contract 阶段类型表面：统一的 `off | shadow | enforce` {@link FeatureGateState}、每个门禁都会记录的固定生命周期元数据（`owner`、`introducedVersion`、`defaultByProfile`、`removalVersion`）、`feature-gates` 注册会携带的 JSON 安全 settings 命名空间值形状、`--dump-config` 的 override 链形状、经脱敏的 shadow/legacy 决策 diff 记录，以及 release-gate 到期检查的签名。

本包目前没有运行时代码：`src/index.ts` 是对 `src/types.ts` 的纯 `export type *` re-export，`src/invariant.ts` 是一个已解释的空实现伴生插件。门禁注册与求值（Provider 阶段）以及 CLI/profile 接线（`--dump-config`，Usage 阶段）是后续 slice 的交付物——见[已知限制与延期工作](#known-limitations-and-deferred-work)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

导入这些 Contract 类型来描述一个门禁及其解析结果——目前还没有运行时构造函数：

```ts
import type { FeatureGateDeclaration, FeatureGateState } from '@deepseek-ai/dsh-feature-gates'

declare const permissionGate: FeatureGateDeclaration
const state: FeatureGateState = 'shadow'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | 完整的 Contract 阶段类型表面：`FeatureGateState`、`FeatureGateDeclaration`、`FeatureGateNamespaceValue`（settings 互操作）、`FeatureGateOverrideSource`/`FeatureGateResolution`（override 链）、`RedactedJsonValue`/`FeatureGateShadowDecisionRecord`（经名义品牌标记的 diff）、`FeatureGateExpiryStatus`/`FeatureGateExpiryCheck` |
| [`src/index.ts`](src/index.ts) | 纯 `export type *` re-export——零运行时表面 |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：已解释的空实现——尚无门禁 registry 或决策事件流存在，可供校验某种关系 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

### Contract 类型表面

#### 模型看到什么

什么都没有。这个 Contract 阶段的 slice 只导出类型；这里的任何东西都不会渲染进模型请求、系统提示词或工具 schema。

#### Token 影响

零直接影响：本包不贡献任何 prompt 或 schema 文本。

#### KV Cache 影响

独立：本包不注册任何参与模型请求的内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **尚无运行时门禁 registry、求值或 `--dump-config` 接线**——这是一个仅 Contract 阶段的 slice（Epic P0-05）；一个 Provider 阶段的 slice 必须针对 `packages/settings/settings/src/index.ts` 的 `SettingsProvider` 添加真正的注册/求值，一个 Usage 阶段的 slice 必须接线 `--dump-config`（`apps/cli/src/dump-config.ts`）来渲染 `FeatureGateResolution` 的 override 链，并让 `apps/cli/src/profile-boot.ts`/`packages/bundle/base/cordis.patch.yml` 携带 `defaultByProfile`。
- **尚无 release-gate 检查的实现**——`FeatureGateExpiryCheck` 只固化了该检查的签名；针对某个发布版本的实际比较，以及把它接入本仓库的 release gate，是后续 slice 的交付物（Epic P0-05 acceptance[2]）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`@deepseek-ai/dsh-brand` 同时位于 `peerDependencies` 与 `devDependencies` 中，与 `dsh-trust-kernel`/`dsh-settings` 自身的分类保持一致。`@deepseek-ai/dsh-util-values` 只位于 `devDependencies` 中，尽管本包里两者都只是 `import type`：`dsh-util-values` 从未出现在任何工作区包的 `peerDependencies` 中（已核查 `packages/` 下的每个消费方），而「仅 `devDependencies`」恰恰是它其他每个仅类型消费方也采用的方式（`dsh-client-connection`、`dsh-client-ui-settings`、`dsh-client-ui-settings-models`、`dsh-cordis-client-runner`——各自都只通过 `import type` 导入 `JsonValue`，与本包相同）。其余约 35 个把它放进真正 `dependencies` 的工作区消费方，都会调用它的某个运行时导出（`isJsonValue`、`snapshotJsonValue`、`deepEqualJson`、`assertNever`、`deepFreeze`）；本包一个都不调用。

</details>
