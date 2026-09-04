# Agent Note: Every memory provider enforces the scope its caller read or wrote under

Status: implemented

[English](2026-09-04-memory-seam-scope-enforcement.md) | 中文

## Problem

`@deepseek-ai/dsh-memory` 在 registry epic P6-01 定义的 `ctx.memory` seam 之后提供三个 `MemoryProvider` 实现。`createDurableFileMemoryProvider` 会存下每次 `propose()` 携带的 `MemoryScope`，并据此过滤每一个操作。`createLocalReferenceMemoryProvider` 与 `createFakeMemoryProvider` 既不存 scope，也不做任何过滤。两者都是对外导出的生产工厂函数——`createFakeMemoryProvider` 的名字描述的是它的检索机制，不是它的可达性——并且一个组合在没有 durable 目录的情况下注册 provider 时拿到的正是它们。

最严重的后果是跨 tenant **写入**，而这正是 P6-01 自身条款没有预料到的类别。`must[3]` 说的是每一次*读取*受 principal、purpose、scope 和 context budget 约束，因此该条款只点名了读取；`revise()` 是写入，不受任何约束。持有某个 record id 的调用方可以用另一个 `tenantId` 调用 `revise()`，静默覆盖另一个 tenant 已存储的内容，而该调用是 resolve 而非 reject 的——调用方被告知它成功了。一个 tenant 修改另一个 tenant 的持久数据，与泄露它是不同的类别，不是它的一个侧面。

其下，用外部 tenant 调用 `forget()` 会直接删除受害者的 record，而 `export()`、`query()` 和 `get()` 会原样返回受害者的内容。三个类别：写入、销毁、泄露。

`sessionId` 维度同样泄露，而这一点重新定义了缺陷的性质。scope 为 `session-2` 的读取能看到同一 tenant 内 `session-1` 的 record。所以这不是"忘了做 tenant 过滤"，而是"过滤根本不存在"：`MemoryScope` 的任何一个维度都没有约束任何操作，这正是 `must[3]` 点名四个维度而非一个的原因。

先前各阶段为何没有发现它——这一点具有普遍意义。Contract 阶段证明的是 seam **拒绝不完整的 access context**；任何地方都没有证明一个**完整**的 access context 真的约束了结果。seam 的两道防线是 `requireCompleteAccessContext`，它检查四个字段是否存在，以及 `capRecords`，它检查一个计数。整个条款是用对*输入形状*的检查来把守的，而不是对其*效果*的检查，这正是 `must[3]` 读起来像已覆盖而实际没有的原因。Provider 阶段确实证明了 scope 过滤——但只针对那个本来就有过滤的 provider。

同一个 fault 阶段还浮现出两个较小的缺陷。`capRecords` 先比较 `records.length <= maxRecords`，再调用 `slice(0, maxRecords)`，因此负数 budget 会让比较为假，并让 slice 从数组末尾倒数：`maxRecords: -1` 在三条 record 上返回了**两条**，同时报告 `truncated: true`。一个大小取决于 budget 数值量级、且其标志位断言约束已被施加的部分结果，比统一的失败更糟，因为标志位正是调用方信任的东西。另外，损坏的 `memory.json` 会从 `JSON.parse` 抛出裸 `SyntaxError`，而紧邻的未知版本分支抛出的是点名了文件的 `MemoryError`——相邻两行把同一类失败报告成了两种样子。

## Decision

scope 的强制执行位于 provider 内部，现在三个 provider 都会执行。`createLocalReferenceMemoryProvider` 与 `createFakeMemoryProvider` 存下各自 `propose()` 携带的 `MemoryScope`，并通过 `inScope`——`createDurableFileMemoryProvider` 早已使用的同一个谓词——过滤每一次读取**和每一次写入**。`revise()` 与 `forget()` 把越界 id 当作从未被 propose 过的 id：`revise()` 抛出 `MEMORY_RECORD_NOT_FOUND`，`forget()` 是 no-op，因此外部 id 与不存在的 id 无法区分，二者都不泄露受害者 record 的存在性。

两个 provider 只共享 `inScope` 谓词，别无其他。它们的数据结构、id 方案与 query 匹配算法保持相异，因为 `acceptance[0]` 要求两个真正独立的实现通过同一套 conformance 套件，而共享存储会把它们塌缩成同一个实现挂了两个 id。这个谓词是基于自身理由的例外：它是两者必须*完全一致*地执行的契约，而一个安全过滤器的两份手写副本正是产生漂移的方式。

`toRecordView` 在每次读取时剥离已存的 scope，因此 `MemoryRecordView` 仍然恰好是 `{id, principal, content, updatedAt}`，读取方看不到新字段。

`capRecords` 把负数 `maxRecords` 钳制为零，使这类读取被约束为空，而不是被约束为从末尾倒数的一个计数。

损坏的 durable 文档抛出点名该文件的 `MemoryError` `MEMORY_CORRUPT_STORE`，并把解析器的错误作为 `cause`。解析器自身的消息不作为失败呈现：其文本随 V8 版本变化，且没有点名任何调用方可用于路由的信息。

### seam 仍然无法执行的部分，以及它的归属

seam 不执行 scope 约束，而且做不到。`MemoryRuntime.query/get/export` 收到的 `MemoryRecordView` 不携带 tenant，因此没有任何东西可以与读取的 `scope` 相比较——返回越界 record 的 provider 会被信任。这个修复让三个已发布的 provider 正确；它没有让该保证独立于 provider。

要关闭它，需要在 `packages/memory/memory/src/types.ts` 的 `MemoryRecordView` 上增加 scope 或 tenant 字段。那是 Contract 面，因此归属方是 P6-01 的 C 阶段 supersession，或 registry epic P6-02——后者拥有取代这个临时视图的规范 `MemoryRecord`，而 `types.ts` 在文件内明确写明本模块不得预先揣度它。fault 阶段改写 Contract 面，正是阶段规则所排除的越权。

解锁信号是机械化的：该残留由 `tests/first100/fixtures/P6-01.fault.spec.ts` 中一个通过的用例钉住，标题为 `CHARACTERIZATION: a hostile provider still returns out-of-scope records, because the seam has no tenant on the record to check`。当归属阶段落地该字段时，这个用例会开始失败。**那次失败是修复到来，不是需要被改回绿色的回归**——届时该用例连同它记录的残留一并删除。

## Testing

`tests/first100/fixtures/P6-01.fault.spec.ts` 包含 27 个用例。其中 16 个在代码落地状态下失败，钉住上述三个缺陷，覆盖两个 provider 与全部四类操作。9 个以 `CHARACTERIZATION:` 为前缀且本就通过，钉住原本正确的故障处理——未知版本与非对象文档的 `MEMORY_UNSUPPORTED_FORMAT_VERSION`、空文档读作首次启动而非损坏、`MEMORY_DUPLICATE_PROVIDER` 及其之后仍可用的注册表、provider 自身 query 中途的 rejection 原样透出、以及 `maxRecords: 0`——外加上述残留，以及 `MemoryContextBudget.maxTokens` 的失效状态：它已被声明，却没有任何代码读取它。

2 个用例以 `control:` 为前缀且同样在 RED 时通过：它们断言**同 tenant** 读取仍能看到自己的 record。它们既不是证明也不是钉住，而变异证明才是说明它们并非装饰的依据。让 `inScope` 拒绝一切——那个貌似合理的错误修复——会让 16 个跨 tenant 用例中的**10 个**保持绿色，同时让两个 control 变红。仅靠安全用例集无法区分一个正确的 scope 过滤器与一个什么都不返回的 seam；只有 control 能把二者分开。

同一次变异也让跨 tenant 的 `revise()` 与 `forget()` 用例变红，因为它们各自都断言受害者的 record **事后仍可读**。这些断言是针对过宽过滤器的承重部分，而非附带的前置准备；把它们简化成一个单纯的 rejection 检查，会移除用例名称并未标示出的冗余。

三个修复都做了双向证明。回退 scope 过滤会让 12 个缺陷用例变红，而 control 与 characterization 保持绿色。回退 budget 钳制恰好让两个负数 budget 用例变红；保持它们分开，是因为其中一个记录了 `truncated: true` 在说谎，另一个记录了结果依赖数值量级，而合并后的用例只能证明先触发的那一个。回退 corrupt-store 包装恰好让两个损坏文档用例变红。把每个 budget 都钳制为零、以及把 `MEMORY_CORRUPT_STORE` 扩大到未知版本分支，各自会让钉住其所抹除的那个区分的用例变红。

没有任何用例断言 `JSON.parse` 的消息或临时路径相等，因此没有用例会在 macOS 通过而在 Linux 为假；每个 `mkdtemp` 目录都在 `afterEach` 中删除，因为 spec 运行在 fork 出的 worker 中。

## Alternatives considered

**在 seam 层执行 scope，使该保证不依赖 provider 的良好行为。** 这是更强的保证，也是读到 per-provider 过滤的人会想到的做法。它在这里不可得：`MemoryRecordView` 不携带 tenant，因此 `MemoryRuntime` 没有可比较的对象，而提供该字段是对 `types.ts` 的 Contract 变更，归属于 C supersession 或 P6-02。在 fault 阶段做它，等于改写一个已冻结的 Contract 面，去满足一个比该条款自身阶段所交付的更强的解读。此处记录并由测试钉住，使该残留不会在下一次重构时蒸发。

**让两个内存 provider 共用一个带 scope 的存储，从而删掉重复的过滤逻辑。** 拒绝：`acceptance[0]` 要求两个独立编写的 provider 通过同一套 conformance 套件，而共享存储会使它们成为同一个实现挂两个 id，这会让 swap 测试什么也证明不了。只共享 `inScope` 谓词，既保留了该 acceptance 条款所关心的独立性，又消除了真正要紧的那份重复。

**用 `MemoryError` 拒绝负数 `maxRecords`，而不是钳制它。** 负数 budget 是调用方的 bug，而失败要响是本仓库的默认。钳制胜出，是因为四个读取约束维度已经恰好只有一条拒绝路径——`MEMORY_ACCESS_CONTEXT_REQUIRED`，针对*缺失*的维度——而给一个其全部目的就是约束结果的 budget 再加一条基于取值的拒绝，等于让调用方为了"请求零条结果"而必须处理新的表面。把读取约束为空，正是"少于零条 record"这个 budget 的含义。若日后确实出现宁愿被告知的调用方，该拒绝仍然可选。

**在修复 corrupt-store 的同时，把每个 provider 的 rejection 都包进 `MemoryError`。** 作为 catch-all 拒绝，本 epic 的 gate 明确点名了它。`MEMORY_CORRUPT_STORE` 是本包自己的读取器能检测并能描述的失败；provider 的后端失败不是，重新包装它只会埋掉一条 seam 并未增益的 `cause` 链。provider 自身 rejection 原样透出这一点，被钉为 characterization，而不是留作未言明的行为。

**在修复 `maxRecords` 的同时实现 `maxTokens`。** 作为超出 fault 用例所证明范围的行为扩展而拒绝。执行它需要选定一套 token 估算策略，那是一个有自身归属方的决定。取而代之的是钉住它的失效状态，使下一位读者遇到的是一个被记录的缺口，而不是一个被假定存在的特性。

## Consequences

在任一 scope 下 propose 的 record，经三个 provider 中的任何一个，都不再在另一 scope 下双向可见。依赖内存 provider 忽略 scope 的调用方——本仓库中不存在；该 seam 唯一的消费者 `packages/context/memory-context` 在其 propose 所用的 tenant 下读取——现在将读到空。

`MEMORY_CORRUPT_STORE` 加入该 seam 的开放字符串 code 集合。消费者本就需要容忍 provider 特有的 code，因此这是增量的。

两个内存 provider 现在每条 record 多持有一个 `MemoryScope` 引用。它们并非持久化，且在进程生命周期内保有 record，因此代价是每条 record 一个指针，不值得测量。

`MemoryContextBudget.maxTokens` 仍然是已声明且失效的。它是本 program 发现的第六个既无生产者也无消费者的声明字段，这是一个关于这些词汇表如何被书写的发现——一个先于其强制执行而写就的类型，对之后遇到它的每个人都读起来像一项保证——而不是关于这个字段本身的事实。

上述残留是这次修复唯一没有买到的东西：怀有恶意的、或仅仅是粗心的 provider 仍然可以返回任意内容，而 seam 会信任它。它已连同归属方与解锁信号记录进本 program 的 lock register，因为只活在测试注释里的残留熬不过下一次重构。
