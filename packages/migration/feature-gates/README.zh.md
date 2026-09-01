---
description: "Epic P0-05 Shadow/Enforce 功能门禁：统一状态与生命周期元数据、纯 override 链解析器、带脱敏 diff 记录的 shadow-vs-legacy 决策求值器，以及基于真实版本比较的 release-gate 到期检查。"
kind: "package-reference"
---

# @deepseek-ai/dsh-feature-gates

[English](README.md) | 中文

## 概述

`dsh-feature-gates` 固化了 Epic P0-05（面向主要能力的 Shadow/Enforce 功能门禁）的类型表面**以及** Provider 阶段运行时：统一的 `off | shadow | enforce` {@link FeatureGateState}、每个门禁都会记录的固定生命周期元数据（`owner`、`introducedVersion`、`defaultByProfile`、`removalVersion`）、`feature-gates` 注册会携带的 JSON 安全 settings 命名空间值形状、`--dump-config` 的 override 链形状、经脱敏的 shadow/legacy 决策 diff 记录，以及 release-gate 到期检查的签名——外加真正计算这一切的纯函数：{@link resolveFeatureGate}（must[3] 的 override 链）、{@link evaluateFeatureGate}（must[1]/acceptance[0]/acceptance[1] 的 shadow-vs-legacy 决策 harness）、{@link redactDecisionSummary}（acceptance[1] 的真实脱敏调用点），以及 {@link checkFeatureGateExpiry}（acceptance[2] 的 SemVer 优先级到期检查）。

面向某个真实能力的门禁注册（本 epic 自身 `validation` 条款要求的 policy、plugin trust、run journal 三个 shadow fixture）以及 CLI/profile 接线（`--dump-config`、bundle/profile-boot 层的 `defaultByProfile`）仍是后续 slice 的交付物——见[已知限制与延期工作](#known-limitations-and-deferred-work)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

解析一个门禁的状态，再用该状态运行它的决策逻辑——`shadow` 始终应用 `legacy` 的结果值，同时对 `candidate` 记录一份经脱敏的 diff：

```ts
import { evaluateFeatureGate, resolveFeatureGate } from '@deepseek-ai/dsh-feature-gates'
import type { FeatureGateDeclaration } from '@deepseek-ai/dsh-feature-gates'

declare const permissionGate: FeatureGateDeclaration
const { resolved } = resolveFeatureGate(permissionGate, 'headless', { env: 'shadow' })

const { value, shadowRecord } = evaluateFeatureGate(
  permissionGate.id,
  resolved.value,
  () => ({ value: 'deny', summary: { outcome: 'deny' } }), // legacy
  () => ({ value: 'allow', summary: { outcome: 'allow' } }), // candidate
  ['outcome'],
)
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
| [`src/index.ts`](src/index.ts) | 重新导出全部 Contract 阶段类型，并新增真正的 Provider 阶段运行时：`resolveFeatureGate`（must[3]）、`evaluateFeatureGate`/`redactDecisionSummary`（must[1]/acceptance[0]/acceptance[1]）、`checkFeatureGateExpiry`（acceptance[2]） |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：已解释的空实现——本包仍不拥有任何可变 registry 或决策事件流；这里的每个 Provider 阶段函数都是纯函数，全部输入都以参数形式传入 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

### Provider 阶段运行时

#### 模型看到什么

什么都没有。这里的每个导出都是纯数据函数或类型；没有任何东西会渲染进模型请求、系统提示词或工具 schema。

#### Token 影响

零直接影响：本包不贡献任何 prompt 或 schema 文本。

#### KV Cache 影响

独立：本包不注册任何参与模型请求的内容。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **尚未为任何真实能力声明门禁**——本包针对调用方传入的任意 `FeatureGateDeclaration` 计算 override 解析、shadow-vs-legacy 求值与到期检查，但自身不声明任何门禁。本 epic 自身 `validation` 条款要求的 policy、plugin trust、run journal 三个 shadow fixture，以及为某个真实能力注册 `feature-gates` settings 命名空间（`packages/settings/settings/src/index.ts` 的 `SettingsProvider.register`），都是 Composition 阶段的交付物。
- **尚无 `--dump-config`/profile 接线**——`resolveFeatureGate` 已经计算出 must[3] 所要求的完整 `FeatureGateResolution`，但仍需一个 Usage 阶段的 slice 去接线 `apps/cli/src/dump-config.ts` 来调用它并渲染结果，并让 `apps/cli/src/profile-boot.ts`/`packages/bundle/base/cordis.patch.yml` 把真实的 `defaultByProfile`/env override 传入其中。
- **尚无仓库 release-gate 的接线**——`checkFeatureGateExpiry` 已经是一个真实、有测试覆盖的 SemVer 优先级检查，但仓库的 release 流水线中还没有任何地方调用它（Epic P0-05 acceptance[2]「在 release gate 中失败」的另一半）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`@deepseek-ai/dsh-brand` 同时位于 `peerDependencies` 与 `devDependencies` 中，与 `dsh-trust-kernel`/`dsh-settings` 自身的分类保持一致（这里仍然只是 `import type`）。一旦 `src/index.ts` 开始直接调用 `@deepseek-ai/dsh-util-values` 的运行时导出（`deepEqualJson`、`assertNever`），它就改到了普通的 `dependencies` 条目——`dsh-util-values` 从未出现在任何工作区包的 `peerDependencies` 中，而普通 `dependencies` 正是它其他每个运行时消费方（`dsh-time-context` 以及另外约 35 个工作区包）采用的方式，与本包这次的新用法一致。

</details>
