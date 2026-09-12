# Policy

[English](policy.md) | 中文

harness 如何判定一个动作是否可以发生:一个策略问题携带什么、一个闭合答案是什么、插件可以往里加什么,以及决策在哪里变成执行。词汇与组合规则位于 [`packages/policy/policy-engine`](../../packages/policy/policy-engine/README.zh.md);其背后的 Cedar 授权器是 [`policy-engine-cedar`](../../packages/policy/policy-engine-cedar/README.zh.md);执行点是 [`policy-enforcement`](../../packages/policy/policy-enforcement/README.zh.md)。

Source: [`packages/policy/policy-engine/src/types.ts`](../../packages/policy/policy-engine/src/types.ts)

<a id="a-policy-question"></a>

## 一个策略问题

`PolicyRequest` 携带五项输入,每一项都必填:发起动作的 `Principal`、出示的 capability token(部署不签发时为 `undefined`)、描述"要做什么"的 `ActionManifest`、执行世界,以及声明式的上下文事实。可选输入会让调用方省略一项却仍然拿到决策——引擎正是这样悄悄开始回答一个比它所记载的更小的问题。

在本树上 `world` 恒为 `{ kind: 'absent' }`。`ExecutionWorld` 属于后续 epic;这个位被声明出来,是为了让"必须知道动作将在何处运行"的策略可以在世界未知时**拒绝**——这与"从没问过"不同。

上下文事实是闭合枚举:工作区的信任状态(镜像 `@deepseek-ai/dsh-workspace-trust`)与会话的权限姿态。自由形态的事实包会让"新增一个事实"变成一次无声的策略变更。

<a id="a-closed-decision"></a>

## 一个闭合决策

`PolicyEffect` 是 `permit | deny | ask`,而 `ask` 表示欠一个人类回答。请使用 `isImmediatelyAllowed` 而不是 `effect !== 'deny'`:后者读起来像"已允许",却把"还没有人回答"的状态算了进去。

每个决策都携带它据以做出的 `PolicySetDigest`,拒绝也不例外。一次分不清"策略变了"与"决策变了"的重放什么也证明不了。

`PolicyReasonCode` 是闭合的,因为它会抵达模型:`no-matching-permit`、`forbidden-by-policy`、`constrained-by-plugin`、`approval-required`、`policy-unavailable`、`policy-set-invalid`、`missing-capability-token`。匹配到的策略 id 与引擎自己的诊断留在 `PolicyExplain` 里,它抵达审计追踪,绝不抵达一次请求。

<a id="what-a-plugin-may-add"></a>

## 插件可以加什么

`PolicyConstraint` 是 `(request) => string | undefined`——按**类型**只能拒绝,与 `ToolGuard` 是同一种构造。`composeDecision` 会应用每一个已注册的约束:`deny` 保持被拒;`permit` 或 `ask` 在任一约束反对时变为 `deny`;顺序不影响结果。即使已经 deny,约束仍会被求值,于是审计记录的是"所有拒绝它的理由",而不是最先撞上的那一个。

插件没有任何一种返回形态能产生 permit——这正是"顺序无关性"是结构性的、而不是组合器施加的一条规则的原因。

<a id="where-a-decision-becomes-enforcement"></a>

## 决策在哪里变成执行

`enforceManifestedAction` 在派发路径刚刚追加完它的 `ActionManifest` 处被调用——**manifest 就是那个策略问题**,因此跳过决策的路径也跳过了 manifest,而那已被 `assertManifestPrecedesExecution` 拒绝。引擎作答,插件可以收窄,被钉住的 Trust Kernel 绑定结果并追加审计记录,然后调用方才动作。

三种失败保持可区分:引擎作答了(`forbidden-by-policy` / `no-matching-permit`)、策略集读不了(`policy-set-invalid`)、完全没挂引擎(`policy-unavailable`)。把其中任意一种并入另一种,都会让坏掉的部署看起来像很严的部署。

provider 是普通插件,可以在会话中途被卸载。不可丢失的是**执行**,因此执行点自己答 `policy-unavailable`,而不是放行。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxpolicy--policyenginecontract"></a>

### `ctx.policy` — `PolicyEngineContract`

What a mounted policy provider answers, whichever engine a profile mounts.

Declared in the DEFINITION so the name means the contract rather than one implementation, and two providers cannot disagree about what `ctx.policy` is. The Cedar provider is `@deepseek-ai/dsh-policy-engine-cedar`.

```ts cordis-catalog
/**
 * Answer one policy question.
 * @param request - the five declared inputs.
 * @returns the closed decision the enforcement point acts on, plus the
 *   audit-only explain it appends.
 */
evaluate(request: PolicyRequest): PolicyEvaluation
```

Source: [`packages/policy/policy-engine/src/types.ts`](../../packages/policy/policy-engine/src/types.ts)

<a id="ctxpolicyconstraints--policyconstraints"></a>

### `ctx.policyConstraints` — `PolicyConstraints`

The registry a plugin adds a constraint to (must[2]).

A service rather than a bare array so a constraint disposes with its plugin's fiber: a plugin that unmounts must stop constraining, and a constraint that outlived its owner would be a policy nobody can find.

```ts cordis-catalog
/**
 * Register one deny-only constraint.
 * @param constraint - returns a reason to deny, or undefined to abstain.
 * @returns the disposer that unregisters it.
 */
register(constraint: PolicyConstraint): () => void

/**
 * Every live constraint, for the enforcement point.
 * @returns the registered constraints, in registration order.
 */
all(): readonly PolicyConstraint[]
```

Source: [`packages/policy/policy-enforcement/src/index.ts`](../../packages/policy/policy-enforcement/src/index.ts)

<a id="ctxpolicyset--policysetprovidercontract"></a>

### `ctx.policySet` — `PolicySetProviderContract`

Where an engine gets the set it enforces (Epic P2-10's Usage stage).

Declared HERE, in the definition, rather than on either side of the seam: the provider that resolves a deployment's policy set and the engine that decides against it must agree on what "the set in force" means, and neither of them owning the word is what keeps a second provider from meaning something else by it.

**`current()` is asked per decision, and returns the set and its digest together.** Both halves matter. Per decision, because the set changes under a running harness — a deployment edits it and the provider re-resolves. Together, because a digest fetched separately can describe a set the provider is no longer yielding: before this seam an engine re-read its policies per call while its digest was computed once at construction, so a reload moved the enforced rules and left every decision citing a set no longer in force.

```ts cordis-catalog
/**
 * The set to decide against, and the pin to record with the decision.
 * @returns the policy set in force at this instant.
 */
current(): CurrentPolicySet
```

Source: [`packages/policy/policy-engine/src/types.ts`](../../packages/policy/policy-engine/src/types.ts)
<!-- END GENERATED cordis-surface -->
