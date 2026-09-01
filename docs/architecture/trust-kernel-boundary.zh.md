# Trust Kernel 边界

[English](trust-kernel-boundary.md) | 中文

Epic P0-02（`确立 Minimal Immutable Trust Kernel 边界`）是[`docs/architecture.md`](../architecture.zh.md)所声称"没有可打补丁的特权核心"与"产品的每个部分都是插件"这一说法的第一个例外。本页精确命名这一例外：Trust Kernel 拥有什么、为何都不是 Cordis 插件，以及其周围哪些仍是插件。同一 Epic 的后续切片会修正 `docs/architecture.md` 本身，使其交叉引用本页，而不是重复这一未加限定的说法。

## kernel 拥有什么

kernel 恰好拥有六项能力——不多不少：

- **Root identity**——进程唯一的 root identity。
- **Signature roots**——进程的签名验证信任锚点。
- **一个 policy-enforcement entrypoint**——一个窄的、与领域无关的 allow/deny 调用。
- **Audit append**——进入 audit-chain root 的仅追加入口。
- **一个 secret-broker handle**——调用方呈递给 secret-broker consumer 的不透明引用，绝不是 secret 值本身。
- **一个 sandbox-attestation verifier**——一个窄的、无副作用的检查。

[`packages/kernel/trust-kernel/src/types.ts`](../../packages/kernel/trust-kernel/src/types.ts) 把这一表面声明为 `TrustKernel` 接口：恰好这六个 `readonly` 成员，每个都是窄函数类型或不透明的不可伪造 handle。kernel 自身的类型表面不携带任何模型可见文本、业务领域逻辑或具体 provider 实现——它接受的每个 payload（`TrustKernelPolicyQuery.payload`、`TrustKernelAuditEntry.payload`、`TrustKernelSandboxAttestation.payload`）对 kernel 而言都是 `unknown`；解读该 payload 是调用方插件的工作，不是 kernel 的。

## 为何 kernel 绝不是 Cordis Service

dsh 中其余一切都是插件：通过 `ctx.plugin(...)` 贡献、由 Loader 解析、可被配置行、补丁或插件卸载所替换。Trust Kernel 不能如此，因为一个能替换掉限制自身的服务的插件，会让 kernel 本应保持的每条生产不变式，都取决于是否有其他插件选择覆盖它。

`packages/kernel/trust-kernel/src/types.ts` 在类型层面体现了这一点：

- 它不导出任何 `Config` schema，也不导出 `apply(ctx, config)` 插件入口——其中没有任何东西具备 Loader 会挂载的形状。
- 它的 `TrustKernelRootIdentity`、`TrustKernelSignatureRoots` 和 `TrustKernelSecretBrokerHandle` handle 都由该模块声明但从不导出的符号打上标记：本包中没有任何导出的值或函数能产生一个这样的值。伪造一个仍然需要在调用点执行一次刻意的、可被 grep 到的不安全操作——`as` 类型断言、`Object.create`，或一个不受约束的泛型——而不是本模块使之变得方便或意外发生的东西。这刻意不同于 `@deepseek-ai/dsh-brand` 中的 `Branded<B>` 字符串品牌惯用法：那种品牌在运行时是一个裸字符串，其 `brandString()` 辅助函数会把任意字符串转换为它，这适合名义上的*标识符*，但不适合不可伪造的*能力*。
- 每个成员都是 `readonly`；表面中没有任何 setter。

后续切片会在 Cordis `Context` 尚不存在之前构造出唯一的 `TrustKernel` 值，将其深度冻结，并用 `ctx.provide('trustKernel', kernel)` 把它钉入 context——与 `packages/boot/app-boot/src/index.ts` 已经用于 `ctx.provide('dshHomePath', dshHomePath)` 的机制相同。`ctx.provide` 写入的值 Loader 永远看不到：没有配置行、补丁或插件卸载能触及它，因为它们全都只作用于 Loader 自己挂载过的东西。与之相对的是 `ctx.plugin(...)`，它通过 Loader 注册，正是本清单中每项其他能力都正确使用的、能被配置、补丁和卸载触及的机制。

`ctx.provide` 单独使用时，其重复注册防护仅检查 `ctx.reflect.store` 对应条目是否已被占用——而该 store 是一个普通的、可变的对象，任何拥有 `ctx` 的插件都能读取它。`@deepseek-ai/dsh-trust-kernel` 的 `pinTrustKernel(ctx, kernel)` 在 `ctx.provide` 成功后立即冻结该具体 store 条目（`Object.defineProperty(..., { writable: false, configurable: false })`），从而关闭由此产生的"先删除、后重新注册"绕过路径，使直接 `delete` 和直接赋值都会抛出异常；正因如此，`apps/cli/src/profile-boot.ts` 调用的是 `pinTrustKernel`，而不是裸的 `ctx.provide`。

后续一次评审发现，仅有这一处冻结还留下三个进一步的可实际利用的绕过：被冻结条目上的 `Impl` 记录本身仍是可变对象（`impl.value = forged` 无需触碰该条目本身，就能一并伪造 `ctx.get('trustKernel')`）；`ctx.trustKernel` 的**属性**访问是通过 root fiber 自身可独立修改的 `store` 来解析的，从不经过 `ctx.reflect.store`，因此任何插件都能全局污染它；而 `ctx.reflect.props['trustKernel']` 可以被替换成一个伪造的 accessor，其优先级还在前述所有防护之前。`pinTrustKernel` 现在同时冻结该 `Impl` 记录、锁定 root fiber 的 store 条目、并锁定 `reflect.props` 的注册——每处修复对应的 vendored Cordis 依据，见 `packages/kernel/trust-kernel/src/index.ts` 中 `pinTrustKernel` 自身的文档注释；运行期证明见 `packages/kernel/trust-kernel/tests/pin-hardening.spec.ts`。

### 已知遗留缺口：仅限自身子树的属性访问污染

`pinTrustKernel` 现在完整保护 `ctx.get('trustKernel')`，也在全局范围内保护 `ctx.trustKernel` 属性访问——针对任何其他插件、root 本身，以及跨兄弟插件均已关闭。唯一遗留的缺口是：插件仍可赋值到它自己 fiber 的 `store` 缓存（`ctx.fiber.store['trustKernel'] = forged`）——父 fiber 链的遍历会在到达 `pinTrustKernel` 锁定的 root fiber store 条目之前，先找到这次写入。这会持久污染该插件自身及其子孙所解析到的 `ctx.trustKernel`（仅限属性访问，绝不影响 `ctx.get`），范围仅限该插件自身的子树，绝不波及兄弟插件或 root（已实测验证，并非纯理论）。在不触碰 vendored Cordis 的 `Fiber` 类（本仓库的 vendoring 策略禁止这样做）的前提下，本仓库自身代码中的防御性包装无法关闭这一遗留缺口。`ctx.get('trustKernel')` 完全没有遗留缺口；无论如何都应优先使用它，而不是 `ctx.trustKernel`。一个 CI 强制门 `verify-trust-kernel-property-access`（接入 `doc-sync`/`ci-primary`/`ci-static`/`check-all`）现在会拒绝任何真实（非 vendor、非测试）代码读取裸 `ctx.trustKernel` 属性，强制一切消费方改走 `ctx.get('trustKernel')`——该遗留缺口从此被结构性地保持不可达，而不仅仅是今天靠 grep 证明的不可达（`spec/first100/exec/BLOCKED-QUEUE.md`，BLOCKED-011）。

## 哪些仍是插件

kernel 上文未命名的一切，仍是普通的、可替换的 Cordis 插件，其组装与打补丁方式与 dsh 其余部分相同：

- **模型**——模型适配器与每个 LLM provider。
- **工具**——工具注册表与每个面向模型的工具。
- **存储 provider**——会话持久化、设置、存储与凭据记录后端。
- **Workflow**——工作流引擎及其 provider。
- **Memory provider**——压缩与会话投影 provider。
- **UI**——web 客户端、宿主网关，以及其他每个界面。

此清单中的插件本身可以调用 kernel 的窄 entrypoint（`policyEnforcement`、`auditAppend`、`sandboxAttestationVerifier`），或把自己的 `secretBroker` handle 呈递给期望它的 consumer；但它绝不能替换发出这些 handle 的一方。

## 哪些绝不是插件

上述所拥有能力清单的反面：root identity、deny enforcement（kernel 的 policy-enforcement entrypoint）、audit-chain root，以及 signature-verification root，无论加载了何种组合、补丁或 profile，都绝不会移到 `ctx.plugin(...)` 之后。

## 本页范围

本页记录 Contract 阶段的类型表面（`packages/kernel/trust-kernel/src/types.ts`、[`packages/kernel/trust-kernel/tests/boundary.spec.ts`](../../packages/kernel/trust-kernel/tests/boundary.spec.ts)）及其所固化的边界。它不涵盖后续的构造切片（`src/index.ts`）或其启动期行为——在 Cordis `Context` 存在之前初始化 kernel，以及未初始化时生产环境 fail-closed／开发环境可显式启用不安全模式并常驻显示警告的划分。这些是 Epic P0-02 的 U 阶段验收条款，将在该切片落地后验证。
