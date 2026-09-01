---
description: "面向用户与维护者的最小、不可替换 Trust Kernel 类型表面：kernel 拥有什么、周围哪些仍是插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-trust-kernel

[English](README.md) | 中文

## 概述

`dsh-trust-kernel` 固化了 Epic P0-02 的 Trust Kernel 可能发放给运行时的窄、不可伪造能力表面：一个 root identity、一个 signature-roots handle、一个 policy enforcement entrypoint、一个 audit append entrypoint、一个 secret broker handle，以及一个 sandbox attestation verifier——恰好六项，不多不少。dsh 中其余一切——模型、工具、存储 provider、workflow、memory provider、UI——仍是普通的、可替换的 Cordis 插件；完整边界与六项为何都不是 Cordis Service，见 `docs/architecture/trust-kernel-boundary.md`。

`src/index.ts` 的 `createTrustKernel` 构造并深度冻结唯一的 `TrustKernel` 值；`apps/cli/src/profile-boot.ts` 在 Cordis `Context` 存在之前调用它，并用 `pinTrustKernel(ctx, kernel)` 把结果钉入 context。除了 `ctx.provide('trustKernel', kernel)` 之外，`pinTrustKernel` 还锁定了插件可能用来伪造或替换该钉入的每条可达路径：service-store 条目本身、位于该条目的 `Impl` 记录、`ctx.trustKernel` 属性访问所经过的其中一条 root fiber 自身的 store 条目，以及插件本可用来替换成伪造 accessor 的 `reflect.props` 注册。`ctx.get('trustKernel')` 在所有场景下都得到完整保护；`ctx.trustKernel`（属性访问）仍带有一个可跨插件树可达的遗留缺口——可达一个兄弟插件或稍后挂载的插件，不仅限于攻击者自身的子孙——目前由一道 CI 强制门在今天真实的源码层面维持为不可达，而非在机制层面彻底关闭；见[已知限制与延期工作](#known-limitations-and-deferred-work)。

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
import { createTrustKernel, pinTrustKernel } from '@deepseek-ai/dsh-trust-kernel'

const kernel = createTrustKernel() // called before the Cordis Context exists
// ...then, inside boot()'s prepare closure, once the Context does exist:
// pinTrustKernel(ctx, kernel) -- never ctx.plugin(...), never a bare ctx.provide()
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
| [`src/index.ts`](src/index.ts) | `createTrustKernel()`：构造并深度冻结唯一的 `TrustKernel` 值；`policyEnforcement` 拒绝、`sandboxAttestationVerifier` 拒绝、`auditAppend` 空操作，直到后续 epic 接入真正的 provider。`pinTrustKernel()`：用 `ctx.provide` 把它钉入 `Context`，再锁定 service-store 条目、其 `Impl` 记录、root fiber 的 store 条目，以及 `reflect.props` 注册，使任何插件都无法伪造、先删除再重新注册，或用替代 accessor 顶替这次钉入 |
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
- **`pinTrustKernel` 完整保护 `ctx.get('trustKernel')`；`ctx.trustKernel` 属性访问带有一个可跨插件树可达的遗留缺口，并非仅限攻击者自身子树**——`ctx.trustKernel` 通过遍历每个 fiber 自己的 `Fiber.store` 缓存、一路向上直到 root fiber 的 store 来解析，而 `pinTrustKernel` 只锁定了 root store 对象内部的 `trustKernel` 这一个键。三个向量都能绕过这把锁：污染某个祖先（非 root）fiber 的 store，会波及挂在该祖先之下的每个插件，包括兄弟插件，不仅限于攻击者自身的子孙；整体替换 root fiber 的 `store` 对象（`Fiber.store` 本身是一个普通的、公开的、可写字段，`pinTrustKernel` 从未整体锁定它）会让这把键锁对之后所有会查到 root 的读取静默失效；登记表级的批量扫描可以一次性污染所有当前存活的 fiber——三者均已在 `tests/pin-hardening.spec.ts` 的「vector G」/「vector H」中实测验证（批量扫描向量与 vector G 机制相同，只是施加到每个 fiber）。`ctx.get('trustKernel')` 在每个向量下都保持正确，root Context 自身的**直接**属性读取（`ctx.root.trustKernel`，而非经由其他 context 引用）同样保持正确——Cordis 的代理 `get` trap 对 root fiber 本身会直接短路到 `ReflectService.get`，从不遍历被污染的那条链；但经由任何**其他** context 的读取，包括兄弟插件或稍后挂载的插件，都会被暴露。在不触碰 vendored Cordis 的 `Fiber` 类的前提下，本仓库自身代码无法关闭祖先向量或批量扫描向量——这是维护者层面的决定，不是本次 slice 可单方面做出的；见 `docs/architecture/trust-kernel-boundary.md#known-residual-cross-plugin-property-access-poisoning`。无论如何都应优先使用 `ctx.get('trustKernel')`——它完全没有遗留缺口。一个 CI 强制门 `verify-trust-kernel-property-access` 会拒绝任何真实（非 vendor、非测试）代码读取裸 `ctx.trustKernel` 属性——点号访问、方括号访问、解构，或是仅能通过类型检查器解析为 `'trustKernel'` 的 key——因此该遗留缺口目前在真实源码层面被维持为不可达，而非在 Cordis 机制层面被彻底关闭：这道门阻止的是本仓库自己的代码走上这条不安全路径，并不会改变 Cordis 自身的行为（`spec/first100/exec/BLOCKED-QUEUE.md`，BLOCKED-011）。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决问题与尚未确定的方向。它明确不具备权威性——已交付的行为与限制记录在上方各节与包代码中。

无。

</details>
