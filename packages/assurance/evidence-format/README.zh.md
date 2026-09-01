---
description: "Release Evidence Package 的 Contract 阶段类型表面,供用户与维护者了解每个 gate 必须报告什么,以及 accepted 不变式如何被结构性强制。"
kind: "package-library"
---

# @deepseek-ai/dsh-evidence-format

[English](README.md) | 中文

## 概述

`dsh-evidence-format` 固定了 Epic P0-07 Release Evidence Package 的类型表面:逐 gate 的 {@link GateEvidence} 记录(命令、时间戳、退出码、环境、日志/工件 digest、测试数、跳过原因——must[0]),以及把 baseline fingerprint、Git diff、构建产物 digest 绑定在一起的聚合 {@link EvidencePackage}(must[1])。`EvidencePackage` 的 `accepted` 字段是一个 tagged union 的判别式:`AcceptedEvidencePackage` 的 `requiredGates` 与 `requiredBuildArtifacts` 是以发布真实必需 id 字面量联合类型为键的完整 `Record<K, V>` map,因此调用方无法让一个遗漏必需 gate 或构建产物、或在应完成的位置赋值跳过/缺失 gate 证据的 `accepted: true` 字面量通过类型检查(must[2])。

本包目前只交付其 Contract 阶段切片:`EvidencePackage`/`GateEvidence` 类型表面(`src/types.ts`)及其 invariant 伴生模块(`src/invariant.ts`)。尚无 `scripts/release/collect-evidence.mjs`/`verify-evidence.mjs` 的产出者或校验器——本切片中不存在任何已构造的 `EvidencePackage` 值。见[已知限制与延后工作](#known-limitations-and-deferred-work)。

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

导入类型表面来标注 gate 产出的证据或一次发布的聚合 package——绝不用于构造它们:

```ts
import type { AcceptedEvidencePackage, CompletedGateEvidence } from '@deepseek-ai/dsh-evidence-format/types'

type RequiredGateId = 'typecheck' | 'lint' | 'test:coverage'
type RequiredArtifactPath = 'lib/index.js'

declare function publishRelease(evidence: AcceptedEvidencePackage<RequiredGateId, RequiredArtifactPath>): void

function isBlockingFailure(gate: CompletedGateEvidence): boolean {
  return gate.exitCode !== 0
}
```

用发布的真实字面量联合类型实例化 `RequiredGateId`/`RequiredArtifactPath`(而非留在其 `string` 默认值)才会触发 `requiredGates`/`requiredBuildArtifacts` 的完整性检查——遗漏一个必需键,或在应为 `CompletedGateEvidence` 处赋值 `SkippedGateEvidence`/`MissingGateEvidence`,都会编译失败。本包不导出 `EvidencePackage`、`GateEvidence` 或任何 branded id/digest 类型的构造函数:后续 P 阶段切片的 `scripts/release/collect-evidence.mjs` 才是从真实发布运行构造这些值的唯一位置,`scripts/release/verify-evidence.mjs` 才是在信任一个已持久化 package 之前校验其 `signature` 的唯一位置。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节说明本包背后的设计决策;可观察的类型契约已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

- **`accepted` 是判别式,不是可任意设置的 boolean 字段。** `EvidencePackage<RequiredGateId, RequiredArtifactPath>` 是 `AcceptedEvidencePackage<...> | UnacceptedEvidencePackage<...>`;只有 `accepted: true` 分支要求完整的、全部为 `CompletedGateEvidence` 的 `requiredGates`,以及完整的 `requiredBuildArtifacts` map。
- **branded 的纯字符串,而非不透明的 `unique symbol` handle。** 与 `@deepseek-ai/dsh-trust-kernel` 仅存于内存的能力 handle 不同,这里的每个 id/digest(`Digest`、`Signature`、`CommitSha`、`GateId`)都是来自 `@deepseek-ai/dsh-brand` 的 `Branded<B>`——运行时就是一个纯字符串。Evidence package 会写入磁盘并完全离线验证(acceptance[1]),因此必须能通过 `JSON.stringify`/`JSON.parse` 往返;symbol 键属性会被 `JSON.stringify` 静默丢弃,这会让本包数据服务的持久化 JSON 变得不可表示。
- **完整性检查是真实的,但有一个诚实且被记录的边界。** 当 `RequiredGateId`/`RequiredArtifactPath` 被实例化为发布的真实字面量联合类型时,`Record<K, CompletedGateEvidence>` 既拒绝遗漏的键,也拒绝形状错误的值——这是真正的编译期证明。若留在其 `string` 默认值(`JSON.parse` 载入的、动态类型 package 必然具有的形状),同一个 map 只会拒绝任一已出现键上形状错误的值;它无法检测遗漏的键,因为以 `string` 为索引的 map 没有固定键集可供比对。`tests/release/evidence-package.spec.ts` 证明并记录了这一退化场景,而非将其隐藏——弥合它是 `scripts/release/verify-evidence.mjs` 的工作(P 阶段),在运行时对照发布实际配置的 blocking-gate manifest 进行核对。
- **类型系统证明的是形状,而非来源真实性。** 没有任何东西能阻止调用方为一个从未运行过的 gate 手写一个形状正确的 `CompletedGateEvidence` 字面量——TypeScript 的结构化类型检查的是形状,不是真实性。弥合这一缺口是 `signature` 的工作:本 Contract 阶段切片只为其预留了字段,由 `verify-evidence.mjs` 对照固定的信任锚点离线校验。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/types.ts`](src/types.ts) | `GateEvidence`/`EvidencePackage` 类型表面:三种 gate 结果变体、branded id/digest 类型,以及以 `accepted` 判别的聚合 package |
| [`src/index.ts`](src/index.ts) | `./types.ts` 的纯类型重导出——零运行时导出、零 Cordis 注册(本 Contract 阶段切片强制性的 B4(f) 脚手架) |
| [`src/invariant.ts`](src/invariant.ts) | Invariant 伴生模块:explained-empty——本切片中尚不存在已构造的 `EvidencePackage` 值或产出者 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [`docs/testing.md`](../../../docs/testing.zh.md#boot-time-baseline-preflight)——既有的 baseline fingerprint 先例(`@deepseek-ai/dsh-baseline-preflight`,Epic P0-01),`BaselineFingerprintBinding` 以 digest 方式绑定它。
- [`tests/release/evidence-package.spec.ts`](../../../tests/release/evidence-package.spec.ts)——Contract 阶段类型表面证明,包括针对 `accepted` 完整性不变式的真实 `tsc` 诊断断言。
- [`packages/kernel/trust-kernel`](../../kernel/trust-kernel/README.zh.md)——本包不透明 vs branded 设计选择明确对照的先例。

-----

<a id="model-experience"></a>
## 模型体验

无,因为本包只导出类型,不注册任何面向模型的内容。

#### KV Cache effect

这里没有任何内容进入模型请求,因此不影响 provider 缓存复用。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **尚无已构造的 `EvidencePackage` 值**——本 Contract 阶段切片只交付类型表面与一个 explained-empty 的 invariant 伴生模块;`scripts/release/collect-evidence.mjs`(从真实发布运行构造)与 `scripts/release/verify-evidence.mjs`(签名/离线校验)是后续 P 阶段的交付物。
- **`requiredGates`/`requiredBuildArtifacts` 的完整性只有在 `RequiredGateId`/`RequiredArtifactPath` 被实例化为发布真实字面量联合类型时才是编译期属性**——留在其 `string` 默认值时,`requiredGates`/`requiredBuildArtifacts` 为空 map 的 `AcceptedEvidencePackage` 字面量仍能通过类型检查(在 `tests/release/evidence-package.spec.ts` 中已被证明并记录,而非被隐藏)。对照发布实际配置的 blocking-gate manifest 核对成员资格是 P 阶段的运行时工作。
- **类型系统证明的是形状,不是真实性**——调用方可以为一个从未运行过的 gate 手写一个形状正确的 `CompletedGateEvidence`;本 Contract 阶段切片中没有任何机制能阻止这一点。`signature` 对照固定信任锚点的离线校验(P 阶段)才是弥合这一缺口的手段,而非 TypeScript。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文:尚待解决的问题与未决方向。它明确不具权威性——已交付的行为与限制记录在上面各节及包代码中。

无。

</details>
