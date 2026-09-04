# Memory

[English](memory.md) | 中文

与提供方无关的持久 Memory 能力接缝(first100 registry P6-01)。[Service Definition 包](../../packages/memory/memory)负责 propose/query/get/revise/forget/export 词汇、提供方选择,以及 `memory/access` 持久会话事件;具体提供方(基于 embedding、基于图、纯文本或其他)是独立的、可替换的包,本页词汇从不指名任何一种。

源码:[`packages/memory/memory/src/types.ts`](../../packages/memory/memory/src/types.ts)

<a id="memory-vs-session-query"></a>

## Memory 与 Session Query

Memory 不是 [Session Query](session-query.zh.md),两者从不可互换:

| | Memory | Session Query |
|---|---|---|
| 读取内容 | 调用方显式 `propose()` 写入持久存储的记录 | 既有的会话/session 语料本身(消息、工具调用、事件) |
| 范围 | 跨 session,以 tenant/principal 为键 | 单个 session(或有界的跨 session 语料读取),以 session 身份为键 |
| 生成方式 | 仅通过显式 `propose()` —— 从不从转录自动派生 | 由进行 session 这一日常行为填充;从没有东西被"propose"进去 |
| 变更 | `revise()`/`forget()` 修改或删除一条持久记录 | 只读:session 自身的日志是 append-only 的,从不通过本接缝编辑 |
| 检索机制 | 由提供方自行定义,本处不作规定(`must[0]`)—— embedding、图或关键词 | 结构化过滤器、来源优先级,以及对已记录事件的全文搜索 |

想要"我们之前在这次对话里讨论了什么"的消费方应使用 Session Query;想要"这个用户曾持久地、跨所有对话地告诉过我们什么"的消费方应使用 Memory。两个接缝互不作为对方的后端:Memory 从不查询 session 日志来回答 `query()`/`get()`,Session Query 也从不读取 `MemoryRecordView`。

## 与提供方无关的词汇

`must[0]` 要求本接缝定义 propose/query/get/revise/forget/export,且不指名任何向量数据库或图数据库。下列每一对请求/结果都刻意对检索机制保持沉默;`MemoryQueryRequest.query` 是自由文本,提供方如何将其转化为匹配记录完全是其自身的事。

```ts type-equiv
/** A candidate write. `propose` is the ONLY mutation entry point a model-facing caller has. */
interface MemoryProposeRequest {
  readonly principal: Principal
  readonly scope: MemoryScope
  readonly content: unknown
}
```

```ts type-equiv
/** Result of a successful `propose()`: the newly minted record's identity. */
interface MemoryProposeResult {
  readonly id: MemoryRecordId
}
```

```ts type-equiv
/** A free-text read request; the seam names no retrieval mechanism (`must[0]`). */
interface MemoryQueryRequest {
  readonly accessContext: MemoryAccessContext
  readonly query: string
}
```

```ts type-equiv
/** Result of `query()`. `truncated` is set when the seam cut `records[]` down to `contextBudget.maxRecords`. */
interface MemoryQueryResult {
  readonly records: readonly MemoryRecordView[]
  readonly truncated: boolean
}
```

`query()`/`get()`/`export()` 返回的 `MemoryRecordView` 是一个**临时的、最小化的**投影,仅满足 Contract 阶段一致性所需。规范的 `MemoryRecord` —— 内容 artifact/ref、种类、主体、来源事件、置信度、TTL、敏感度、状态,以及 supersedes/disputes 关系 —— 是 first100 registry P6-02 在后续 wave 的工作,并将取代此形状。

## 读取范围限定(`must[3]`)

每次读取(`query`、`get`、`export`)都携带一个完整的 `MemoryAccessContext`:

```ts type-equiv
/**
 * The four dimensions `must[3]` requires on every memory read: who is
 * reading (`principal`), why (`purpose`), within what boundary (`scope`),
 * and under what size bound (`contextBudget`). Carried by `query`, `get`, and
 * `export` — the seam rejects a read whose access context is incomplete.
 */
interface MemoryAccessContext {
  readonly principal: Principal
  readonly purpose: string
  readonly scope: MemoryScope
  readonly contextBudget: MemoryContextBudget
}
```

`principal` 和 `scope.tenantId` 复用了 first100 registry P2-01 身份接缝的 [`Principal`/`TenantId`](../../packages/identity/principal/src/types.ts),而非另造一套并行身份词汇。`purpose` 在 Contract 阶段是开放字符串 —— 不强加固定分类。`contextBudget`(`maxRecords`/`maxTokens`)由接缝自身在提供方返回之后强制执行,与 `WebRuntime` 的 `maxResults` 强制执行方式相同(`@deepseek-ai/dsh-web`):一个过量返回的提供方永远无法泄露超出调用方预算的记录。

## 无持久写入旁路(`acceptance[1]`)

`propose()` 是本包唯一的变更入口 —— `MemoryProvider` 上没有 `write`/`set`/`put` 动词。持久记录的身份总是在 `propose()` 内部由提供方铸造;`revise()`/`forget()` 只对某个先前 `propose()` 真正返回过的 id 操作,因此调用方无法通过编造一个 id 并直接调用 `revise()` 来伪造一条持久记忆。

## 提供方可替换性(`must[1]`)

`MemoryRuntime`(`ctx.memory`)镜像了 `WebRuntime` 的选择语义:已注册且可用的已配置提供方 id 胜出;若未配置,则运行唯一已注册的可用提供方;零个或多个可用提供方会明确失败(`MEMORY_PROVIDER_UNAVAILABLE` / `MEMORY_PROVIDER_AMBIGUOUS`)。选择从不依赖注册顺序,因此替换 `ctx.memory` 背后的提供方从不需要修改消费方代码。

## 消费方必须经由 Service Definition(`must[2]`)

`ctx.memory` 是唯一预期的入口点。单独存在的 `MemoryProvider` 对象是惰性的 —— 构造它不产生任何效果,直到 `ctx.memory.registerProvider()` 使其可达为止;不存在可绕过本接缝直接调用的独立 `proposeMemory()`/`queryMemory()` 导出。

随包提供的消费方是 [`@deepseek-ai/dsh-memory-context`](../../packages/context/memory-context/README.zh.md),它在每个步骤召回记录并追加到请求中。它注入 `memory` 服务并调用之;它不 import 任何提供方,也不 import `MemoryRuntime` 类,因此替换已挂载的提供方会改变它召回的内容,而消费方本身无需改动。

### 模型可见之处即被记录之处(`validation[3]`)

进入模型请求的 memory 记录,必须仅凭会话日志就能重建。消费方由构造而非事后审计满足这一点:注入的 `user/message` 与其 `memory/access` 事件由同一次读取结果在同一条代码路径上产生,因此二者不可能只出现其一。`memory/access` 是已登记的 `SessionEventMap` 成员,因此携带它的日志能通过持久化读取路径完成回放,而不会被当作未知类型拒绝。

接缝自身不发出任何事件。除本消费方以外的 `ctx.memory` 调用方,除非自己追加事件,否则不会记录任何内容;因此日志对经由会写入事件的消费方所做的读取是完整的,而非对任何可设想的调用方都完整。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmemory--memoryruntime"></a>

### `ctx.memory` — `MemoryRuntime`

The memory access service. Registered as `ctx.memory` (one instance per context).

Selection semantics (resolved at execution time, never order-dependent):

- A configured id that is registered and `available()` → that provider.
- A configured id not registered → `MEMORY_PROVIDER_CONFIGURED_MISSING`.
- A configured id registered but unavailable → `MEMORY_PROVIDER_CONFIGURED_UNAVAILABLE`.
- No id configured, exactly one registered usable provider → that provider.
- No id configured, multiple usable providers → `MEMORY_PROVIDER_AMBIGUOUS`.
- No id configured, no usable provider → `MEMORY_PROVIDER_UNAVAILABLE`.

```ts cordis-catalog
/**
 * Register a memory provider. Throws {@link MemoryError}
 * `MEMORY_DUPLICATE_PROVIDER` if its id is already registered. Returns a
 * disposer; disposed with the calling fiber.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters the provider.
 */
registerProvider(provider: MemoryProvider): () => void

/**
 * Submit a candidate write. The only mutation entry point this seam
 * exposes (`acceptance[1]`).
 * @param request - the candidate content, its principal, and its scope.
 * @returns the newly minted record's identity.
 */
async propose(request: MemoryProposeRequest): Promise<MemoryProposeResult>

/**
 * Run a free-text read through the selected provider, capped to
 * `request.accessContext.contextBudget.maxRecords`.
 * @param request - the query and its complete access context.
 * @returns matching records, capped to the caller's budget.
 */
async query(request: MemoryQueryRequest): Promise<MemoryQueryResult>

/**
 * Fetch one record by id.
 * @param request - the record id and its complete access context.
 * @returns the record, or `undefined` when no such record is visible to the access context.
 */
async get(request: MemoryGetRequest): Promise<MemoryRecordView | undefined>

/**
 * Update an existing record's content. Rejected when `request.id` was
 * never returned by a prior `propose()` (`acceptance[1]`).
 * @param request - the target id, its new content, its principal, and its scope.
 * @returns Nothing.
 */
async revise(request: MemoryReviseRequest): Promise<void>

/**
 * Remove a record. Idempotent.
 * @param request - the target id, its principal, and its scope.
 * @returns Nothing.
 */
async forget(request: MemoryForgetRequest): Promise<void>

/**
 * Bulk-read every record visible to `request.accessContext`, capped to
 * `contextBudget.maxRecords`.
 * @param request - the complete access context.
 * @returns every visible record, capped to the caller's budget.
 */
async export(request: MemoryExportRequest): Promise<MemoryExportResult>
```

Source: [`packages/memory/memory/src/index.ts`](../../packages/memory/memory/src/index.ts)
<!-- END GENERATED cordis-surface -->

## 状态

Contract、Provider 与 Usage 阶段(first100 registry P6-01,C+P+U)。`MemoryRuntime` 的提供方注册表/选择逻辑、三个提供方(`createLocalReferenceMemoryProvider()`/`createFakeMemoryProvider()`/`createDurableFileMemoryProvider()`),以及 `query()`/`get()`/`export()` 中的 `must[3]` 读取范围限定强制执行均已真实实现(`packages/memory/memory/src/index.ts`),由 [`conformance.spec.ts`](../../packages/memory/memory/tests/conformance.spec.ts) 与 [`durable-provider.spec.ts`](../../packages/memory/memory/tests/durable-provider.spec.ts) 覆盖。

Usage 阶段补上了真实调用点:[`@deepseek-ai/dsh-memory-context`](../../packages/context/memory-context/README.zh.md) 把 memory 召回进真实请求并发出 `memory/access`,而 `dsh-base` bundle 以 `disabled: true` 的行携带它与 `dsh-memory`,供 profile 主动启用。[`memory-context.spec.ts`](../../packages/context/memory-context/tests/memory-context.spec.ts) 通过 Loader 启动已发布的 headless profile,针对该次运行写下的持久 JSONL 日志断言召回及其事件,随后再经持久化读取路径重新加载该日志以证明它可以回放。

本包未发布 `./invariant` 伴生模块(见[包 README](../../packages/memory/memory/README.zh.md#understand-the-implementation))。
