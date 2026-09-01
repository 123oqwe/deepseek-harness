# Agent Note: 在任何真实 gate 存在之前先接线 feature-gate 机制

Status: implemented

[English](2026-09-01-feature-gate-mechanism-wiring-before-any-real-gate.md) | 中文

## 问题

Epic P0-05 的 Provider 阶段（`@deepseek-ai/dsh-feature-gates`）已经搭建了真实、纯函数的 `resolveFeatureGate`/`evaluateFeatureGate`/`checkFeatureGateExpiry`，但代码库中没有任何地方调用它们：`--dump-config`（must[3]，"必须展示最终解析出的 gate 来源和完整覆盖链"）完全没有渲染 feature gate；也没有任何 gate 声明的过期状态在发布流水线的任何环节被检查（acceptance[2]，"过期 gate 在 release gate 中失败"）。Epic P0-05 自身的 nonGoals 禁止在这里声明一个真实的能力 gate（"不引入与本项无关的垂直业务逻辑"），而这个仓库目前也确实没有任何能力真正迁移到 gate 之后，因此 U 格的接线必须做到真实且可测试，同时不声明任何生产用途的 gate。

## 决策

- **共享同一个解析函数，而非重复计算。** `apps/cli/src/profile-boot.ts` 新增 `FEATURE_GATE_DECLARATIONS`（空）、`featureGateEnvVarName`/`resolveFeatureGateEnvOverride`（真实的 `env` 覆盖链层，`DSH_FEATURE_GATE_<ID>`）以及 `resolveProfileFeatureGates(profile, declarations, env)`。`apps/cli/src/dump-config.ts` 新增的 `renderFeatureGateDump` 与 `runProfile` 的启动流程都调用这同一个函数，因此对同一个 profile/环境，`--dump-config` 与真实启动的结果保持一致。
- **不新增 Cordis Context 服务的类型声明合并。** `runProfile` 用裸字符串 `hostCtx.provide('featureGates', resolveProfileFeatureGates(options.profile))` 提供解析结果，而不是写一个 `declare module '@deepseek-ai/cordis' { interface Context { featureGates: ... } }` 声明块。经过对全仓库的穷举检索，本仓库现存的每一处服务类型声明合并都位于该能力自身所属包的 `src/index.ts` 中——`dsh-trust-kernel`、`dsh-launch-environment`、`dsh-cmdline` 等皆如此——从未出现在 `apps/cli` 里。而这里真正的所有者包 `packages/migration/feature-gates` 并不在本 epic U 格声明的 `files[]`（仅 `profile-boot.ts`/`dump-config.ts`/`cordis.patch.yml`）之内。Cordis 自身的 `ReflectService` 已经把 `get(name: string, strict?: boolean): any` 与 `provide(name: string, value?: any): () => void` 显式声明为"服务名在类型化 Context 表面之外"时的重载（`vendor/cordis/src/reflect.ts`），所以这是一条受支持的、而非取巧的逃生通道。类型化的表面被推迟到未来某个真正注册第一个真实 gate 的 epic。
- **`cordis.patch.yml` 不新增任何一行。** 完整读完整个文件确认：文件里的每一行都在挂载一个真实的 Cordis 插件。Feature gate 和 Trust Kernel（Epic P0-02）一样，是一种非插件的启动期机制，本身没有任何能力可挂载——`pinTrustKernel` 在那个文件里同样没有一行。
- **acceptance[2] 接入仓库真实的 release gate，而非 P0-07 的证据收集器，也不是本项目自己的 ledger。** `scripts/release/verify.ts`（`pnpm run release:verify`）是这个仓库已经存在、真实从 GitHub Actions 为每一次 `dsh` family 发布运行的 release gate；它的 `verifyVersions` 步骤已经保证了 `dsh` family 所有成员共享同一个版本，而这恰好就是 `FeatureGateDeclaration.removalVersion` 所定义的那个harness 版本体系。新增的 `scripts/release/feature-gate-expiry.ts` 导出 `assertNoExpiredFeatureGates`（复用 `checkFeatureGateExpiry`，而非重新实现一遍）以及它自己的 `RELEASE_GATE_FEATURE_GATES`（同样为空），只在 `dsh` family 时接入 `verify.ts` 的 `main()`。
- **两份独立的空声明列表，而非共享一份。** `apps/cli/src/profile-boot.ts` 的 `FEATURE_GATE_DECLARATIONS` 与 `scripts/release/feature-gate-expiry.ts` 的 `RELEASE_GATE_FEATURE_GATES` 不是同一个数组。`apps/cli`（`@deepseek-ai/dsh`）是一个纯 bin 包（`package.json` 中 `"exports": null`，由 `scripts/verify-application-entrypoints.ts` 强制），因此包外代码无法从它的 `src/` 导入任何东西；本仓库自身的约定要求跨包导入必须走包名，绝不能用跨越包边界的相对路径（`AGENTS.md`："Use package names across packages and .ts in local relative imports"）。未来某个声明真实能力 gate 的 epic，需要把它同时注册进这两份列表。

## 已考虑但未采纳的方案

**现在就在 `apps/cli/src/profile-boot.ts` 里加上 `declare module '@deepseek-ai/cordis'` 的类型声明合并。** 否决：本仓库中没有任何一处服务类型声明合并位于其所属能力包之外，而这里真正的所有者（`dsh-feature-gates`）并不在本 epic U 格声明的范围内；在没有真实消费者的情况下在那里加上它，正是本 epic nonGoals 所警惕的"提前搭建生产形态机制"。

**给 `apps/cli` 加一个 `profile-boot.ts` 的包导出，让 `scripts/release/verify.ts` 能直接导入它的已声明 gate 列表。** 否决：`apps/cli` 被刻意设计为纯 bin 包——`docs/architecture.md` 的应用启动规则禁止"公开 SDK argv 逃生口"，仅仅为了共享一个空数组就新增导出表面，对一个尚无真实 gate 的机制而言是不成比例的额外机制。

**把 acceptance[2] 接入 `scripts/release/collect-evidence.mjs`/`verify-evidence.mjs`（同一 wave 的 Epic P0-07）。** 否决：那套机制校验的是 first100-registry 某个 gate 命令的捕获输出（日志/产物摘要）——与 feature gate 的版本生命周期完全是不同的领域。把二者耦合在一起，读起来像是越过本 epic 边界的范围蔓延，而非自然的集成点。

## 后果

`pnpm dsh --profile <name> --dump-config` 与 `pnpm run release:verify --family dsh` 今天都在真实运行这套机制，但都不打印/不检查任何新内容：两份已声明 gate 列表都是空的，这与仓库的真实状态一致（没有任何能力已迁移到 gate 之后）。这条接线本身通过合成的测试声明端到端得到证明：`apps/cli/tests/feature-gate-boot.spec.ts` 启动一次真实的 Cordis Loader composition（复刻 `packages/kernel/trust-kernel/tests/boot.spec.ts` 的模式），证明一个已挂载的插件可以读到 `ctx.get('featureGates')`；`apps/cli/tests/dump-config-feature-gates.spec.ts` 证明 `renderFeatureGateDump` 精确的逐行 provenance 输出；`scripts/release/feature-gate-expiry.spec.ts` 针对一个合成的已过期声明，证明 `assertNoExpiredFeatureGates` 会失败并点名每一个过期的 gate。
