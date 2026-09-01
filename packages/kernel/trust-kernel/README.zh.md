---
description: "面向用户与维护者的最小、不可替换 Trust Kernel 类型表面：kernel 拥有什么、周围哪些仍是插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-trust-kernel

[English](README.md) | 中文

## 概述

`dsh-trust-kernel` 固化了 Epic P0-02 的 Trust Kernel 可能发放给运行时的窄、不可伪造能力表面：一个 root identity、一个 signature-roots handle、一个 policy enforcement entrypoint、一个 audit append entrypoint、一个 secret broker handle，以及一个 sandbox attestation verifier——恰好六项，不多不少。dsh 中其余一切——模型、工具、存储 provider、workflow、memory provider、UI——仍是普通的、可替换的 Cordis 插件；完整边界与六项为何都不是 Cordis Service，见 `docs/architecture/trust-kernel-boundary.md`。

`src/index.ts` 的 `createTrustKernel` 构造并深度冻结唯一的 `TrustKernel` 值；`apps/cli/src/profile-boot.ts` 在 Cordis `Context` 存在之前调用它，并用 `ctx.provide('trustKernel', kernel)` 把结果钉入 context。哪些能力背后仍无具体 provider，见[已知限制与延期工作](#known-limitations-and-deferred-work)。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

导入 `TrustKernel` 类型表面来为插件收到的能力标注类型——而不是用来构造它：

```ts
import type { TrustKernel, TrustKernelPolicyQuery } from '@deepseek-ai/dsh-trust-kernel/types'

declare function handleRequest(kernel: TrustKernel): void

function checkPolicy(kernel: TrustKernel, payload: unknown): boolean {
  const query: TrustKernelPolicyQuery = { payload }
  return kernel.policyEnforcement(query) === 'allow'
}
```

`TrustKernelRootIdentity`、`TrustKernelSignatureRoots`、`TrustKernelSecretBrokerHandle` 各自都没有导出的构造函数——只有 `createTrustKernel()` 能产出一个完整的、已冻结的 `TrustKernel`：

```ts
import { createTrustKernel } from '@deepseek-ai/dsh-trust-kernel'

const kernel = createTrustKernel() // called before the Cordis Context exists
// ...then, inside boot()'s prepare closure, once the Context does exist:
// ctx.provide('trustKernel', kernel) -- never ctx.plugin(...)
```

`apps/cli/src/profile-boot.ts` 是唯一的调用方：它在 `boot()` 创建 Cordis `Context` 之前就构造好 kernel，再从 `boot()` 已暴露的 `prepare` 闭包里把它钉入那个 context。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释包背后的设计决策；可观察的类型约定已在[使用本包](#use-this-package)中完整覆盖。

### 设计哲学

- **恰好六项拥有的能力，不多不少。** `TrustKernel` 只声明 Epic P0-02 must 条款所列内容：root identity、signature roots、policy enforcement entrypoint、audit append、secret broker handle、sandbox attestation verifier。
- **不可伪造的 handle，而非品牌化字符串。** `TrustKernelRootIdentity`、`TrustKernelSignatureRoots`、`TrustKernelSecretBrokerHandle` 均由本模块声明但从不导出的 symbol 打标，因此任何调用方都无法在不做显式不安全类型转换的情况下构造出一个合法值。这刻意不同于 `@deepseek-ai/dsh-brand` 的 `Branded<B>` 字符串品牌写法：`Branded<B>` 在运行时就是一个裸字符串，其 `brandString()` helper 可以把任意字符串转换成它——这适合名义上的*标识符*，但不适合不可伪造的*能力*。
- **领域无关的 entrypoint。** `policyEnforcement`、`auditAppend`、`sandboxAttestationVerifier` 只接受不透明（`unknown`）的 payload。kernel 只负责路由与追加；它从不解释一个 query、一条 audit entry 或一份 attestation 的含义——那是调用插件自己的业务领域逻辑。
- **永远不是 Cordis 插件。** 本包不导出 `Config` schema，也不导出 `apply(ctx, config)` entry，因此这里的任何东西都无法用 `ctx.plugin(...)` 挂载、被 `cordis.patch.yml` 的某一行 patch，或被插件卸载替换。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | `TrustKernel` 类型表面：其六个能力成员、三个不透明 handle 类型，以及三个窄 entrypoint 函数类型 |
| [`src/index.ts`](src/index.ts) | `createTrustKernel()`：构造并深度冻结唯一的 `TrustKernel` 值；`policyEnforcement` 拒绝、`sandboxAttestationVerifier` 拒绝、`auditAppend` 空操作，直到后续 epic 接入真正的 provider |
| [`src/invariant.ts`](src/invariant.ts) | 不变式伴生插件：已解释的空实现——唯一钉入的身份保证由 Cordis 自身的 service-store 语义强制，而非本包拥有的任何事件流或可变数据 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- `docs/architecture/trust-kernel-boundary.md`——kernel 拥有什么、为何其中没有一项是 Cordis Service，以及周围的插件/永不插件划分。
- [`spec/trust-kernel.md`](../../../spec/trust-kernel.md)——规范化的能力表面与 Epic P0-02 的 must/acceptance 条款。
- [`packages/boot/app-boot`](../../boot/app-boot/README.zh.md)——拥有 `ctx.provide('dshHomePath', ...)`，`apps/cli/src/profile-boot.ts` 正是照此模式把构造出的 `TrustKernel` 钉入 Cordis `Context`。

-----

<a id="model-experience"></a>
## 模型体验

### Kernel 类型表面

#### 模型看到什么

什么都没有。`createTrustKernel()` 的六个成员不带任何模型可见文本（依 `spec/trust-kernel.md` acceptance 条款 2），因此本包中没有任何东西会渲染进模型请求、系统提示词或工具 schema。

#### Token 影响

零直接影响：本包不贡献任何 prompt 或 schema 文本。

#### KV Cache 影响

独立：本包不注册任何参与模型请求的内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **尚无具体的 policy/audit/attestation provider** ——`policyEnforcement` 无条件拒绝、`sandboxAttestationVerifier` 无条件拒绝、`auditAppend` 无条件空操作；把真正的 policy 引擎、audit 链持久化或 attestation 验证器接到这些 entrypoint 背后是后续 epic 的交付物（`spec/trust-kernel.md` acceptance 条款 2 要求本包自身的 API 表面不带任何具体 provider 实现）。
- **启动期 fail-closed/insecure 选择进入的强制执行归属 `apps/cli`，不在本包**——`apps/cli/src/profile-boot.ts` 的 `enforceTrustKernelPosture` 与 `DSH_TRUST_KERNEL_INSECURE` 选择进入项拥有"生产环境必须 fail closed／开发环境可显式启用 insecure 警告"这一划分（Epic P0-02 acceptance 条款 3）；本包只负责构造并冻结那个决策会钉入或省略的值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决问题与尚未确定的方向。它明确不具备权威性——已交付的行为与限制记录在上方各节与包代码中。

无。

</details>
