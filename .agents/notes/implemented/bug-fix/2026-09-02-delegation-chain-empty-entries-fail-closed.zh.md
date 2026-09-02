# Agent Note: DelegationChain accessors fail closed on empty `entries`

Status: implemented

[English](2026-09-02-delegation-chain-empty-entries-fail-closed.md) | 中文

## 问题

`DelegationChain.entries`(`packages/identity/principal/src/types.ts`)被定型为非空元组(`readonly [DelegationEntry, ...DelegationEntry[]]`),使"没有 root"在类型层面不可表达——但这个保证只约束真正走过 `createChain`/`extendChain`(`packages/identity/principal/src/chain.ts`)的调用方。registry epic P2-01 的 Fault 阶段对已经加固过的身份/租户/管理员核心(`chain.ts`、`packages/core/agent-loop/src/runtime-context.ts`)做了真实的对抗性 fault-testing:构造了五个真实攻击类别,而不是审阅代码去猜可能的 bug——`resolveSessionIdentity` 的并发/TOCTOU、经由手工构造(非 `extendChain`)的 `DelegationChain` 造成的跨租户混淆、非管理员租户身份的序列化边界、委托深度/环形链的资源耗尽,以及匿名开发者与管理员的等价性。其中四个被既有设计干净地挡下。第五个发现了一个真实 bug:`rootPrincipal` 与私有的 `lastEntry` 辅助函数(支撑 `currentPrincipal`/`currentTenantId`/`rootTenantId`)在一个运行时 `entries` 为空的 `DelegationChain` 上,会以不透明的 `TypeError` 崩溃——`rootPrincipal` 抛出 `Cannot read properties of undefined (reading 'principal')`,`lastEntry` 抛出 `Reduce of empty array with no initial value`。

这是真实可达的输入,不是仅存在于单元测试里的人为构造。`packages/core/session/src/chunk-rows.ts` 的 `decodeStorageRecord` 只校验带 chunk-row 标签的存储行(`text-chunks`/`reasoning-chunks`/`tool-call-chunks`);它自己的文档明确写明"每一个其他值都原样作为单个事件透传,不做校验"。`identity/attached` 事件(`SessionEventMap['identity/attached']`,`packages/core/session/src/types.ts:311`)正是这样一个未经校验的值:一行被损坏或手工编辑过的会话日志,会直接解码进 `SessionEvent['data']['identity']`,对其 `DelegationChain` 形状没有任何 schema 检查。`lastAttachedIdentity`(`packages/core/agent-loop/src/runtime-context.ts`)正是从会话的事件流中读出这个值,并把它作为 `recorded` 交给 `resolveSessionIdentity`;`ReactLoopAgent` 的构造函数(`packages/core/agent-loop/src/agent.ts:115`)在函数体里直接调用 `resolveSessionIdentity(lastAttachedIdentity(session), options.identity)`,解码与这次调用之间没有任何守卫。一个损坏的 `entries: []` 无论出现在 `recorded` 还是 `supplied` 一侧,都会让 agent 构造本身以一个不透明、无文档说明的失败崩溃,而不是一次清晰、有意的拒绝。

验证方法:变异测试(mutation testing),而不只是一个能通过的回归测试。撤销修复(相当于 `git stash` 掉 `assertNonEmptyChain()` 那两处调用)会在新增的回归测试里复现出一模一样的不透明 `TypeError`(RED);恢复修复后测试转绿(GREEN)——证明这些测试确实在执行崩溃路径,而不是空洞地通过。

## 决策

新增一个私有辅助函数 `assertNonEmptyChain(chain)`(`chain.ts`),在 `chain.entries.length === 0` 时抛出一个纯 `Error`——`'invalid DelegationChain: entries is empty -- a chain must contain at least a root entry'`。`rootPrincipal` 与私有的 `lastEntry`(被 `currentPrincipal` 共用,并因此间接支撑 `currentTenantId`/`rootTenantId`)都先调用它,因此每一个读取 `entries[0]` 或对 `entries` 做 fold 的访问器,现在都以同一个清晰、专门的错误失败,而不是各自不同的崩溃。两处调用点都补上了 `@throws {Error}` 的 JSDoc。

回归覆盖:`packages/identity/principal/tests/identity.spec.ts` 证明 `rootPrincipal`/`currentPrincipal`/`currentTenantId`/`rootTenantId` 在 `{ entries: [] } as unknown as DelegationChain` 上都会抛出这条清晰消息(并显式断言 `.not.toThrow(TypeError)`),另加一个对照用例确认结构良好的 chain 不受影响。`packages/core/agent-loop/tests/runtime-context.spec.ts` 证明这个修复在 `resolveSessionIdentity` 自己的调用边界上确实可见——分别针对 `recorded` 与 `supplied` 两侧,这两个输入分别真实来自会话日志重放和调用方新构造。

## 已考虑的替代方案

### 为什么不用一个具名错误类(对齐 `TenantMismatchError`/`ForgedPrincipalError`)?

刻意保留为纯 `Error`,是在权衡本文件自身既有惯例之后做出的选择。`TenantMismatchError` 与 `ForgedPrincipalError`(`types.ts`)都代表对抗性的、策略层面的判定:一个 hop 或一个 agent id,按本包强制的规则确实是错的,各自携带调用方可以分支处理的结构化字段(`attemptedTenantId`/`actualTenantId`、`claimedPrincipalId`),并且各自都有正当理由让调用方捕获后区别处理——一个确实换了租户的恢复会话、一个应以特定响应拒绝的伪造 agent id。空 `entries` 是另一类失败:一个类型系统本已宣称不可能出现的数据结构不变式被打破,除消息外不携带任何数据,除了把整个 `IdentityContext` 当作已损坏并拒绝继续之外没有正当的处理路径。具名类会邀请调用方做出正是那两个策略错误所设计的那种选择性捕获与分支,而这恰恰是"不该发生"状态的错误信号——它意味着上游数据已损坏,而不是某个行为体触犯了某条安全规则。`assertNonEmptyChain` 的文档在 F 阶段修复落地时就已使用 `@throws {Error}`;本轮确认那是正确的分类,而非需要纠正的疏漏。被否决的替代方案:新增一个 `EmptyDelegationChainError` 类——它不会携带可分支的数据,也没有区别于"这个身份已损坏"的正当处理路径,反而会把一个不该发生的不变式破坏,误呈现成一个正常的策略结果。

### 为什么修复落在访问器层(`rootPrincipal`/`currentPrincipal`/`currentTenantId`),而不是会话日志的接入边界(`decodeStorageRecord`)?

`decodeStorageRecord` 自己的文档已经披露它只校验三种 chunk-row 标签,其余值一律透传、不做校验——这是整个 `SessionEvent` 联合类型上一个已知的既有缺口,并非本次修复引入。真正补上它,要么在解码时对每一种会话事件变体做 schema 校验,要么在会话存储层单独为 `identity/attached` 特判——后者会让 `dsh-session`(一个通用的持久化日志编解码器)伸手进入 `dsh-principal` 的 `DelegationChain` 形状,这不是本包分层(`chain.ts` 的纯逻辑、`packages/core/agent-loop` 的真实接线、`packages/core/session` 的存储)本来采取的方向。这两个选项的工作量都超出一次 `dsh-principal` 的 fault-testing 修复,规模属于 `dsh-session`,本轮均未尝试。

更决定性的一点是:无论接入边界的校验将来是否补上,访问器层的修复都是必需的——因为本轮同一次 fault-testing 构造出的另一个攻击向量,一个手工构造的 `DelegationChain` 对象字面量,与会话日志无关,会直接触达 `rootPrincipal`/`currentPrincipal`,完全绕过 `decodeStorageRecord`。只在接入处校验会放过这个向量;在访问器处校验则一次性关闭两者,因为无论损坏数据是怎么到达的,这里才是一个被打破的不变式原本会导致未定义行为的那个真实落点。在接入边界做纵深防御,对 `dsh-session` 自身已披露的缺口而言仍是一项正当的未来改进,但并非本轮额外必要的举措:现在只做一部分并不划算(只校验 `identity/attached` 而放着联合类型其余部分不管,是不一致而非真正更安全的做法),而访问器层的这道守卫已经为这一具体不变式提供了完整、通用的保护。被否决的替代方案:专门为 `identity/attached` 在 `decodeStorageRecord` 加 schema 校验——它单独并不能关闭手工字面量这个向量,而且是对一个整族缺口的局部(单一事件类型)修复,`dsh-session` 有责任整体补上,不值得单独去做。

**让访问器返回 `undefined` 而不是抛出。** 未采纳:每一个调用方(`extendChain`、`assertAgentDelegationValid`、`resolveSessionIdentity`、`assertRuntimeTenantPolicy`)都按类型把返回值当作恒定存在;返回 `undefined` 只会把这个不透明崩溃向后挪一个调用帧,挪到一个对"是哪个 chain 出了问题"掌握更少上下文的位置。

## 后果

`rootPrincipal`/`currentPrincipal`/`currentTenantId`/`rootTenantId` 现在会在一个结构无效的 chain 上,以一条清晰、可 grep 的消息失败关闭,失败点正是无效数据原本会导致未定义行为的那个确切位置——由变异测试证明(撤销后复现原始不透明崩溃;恢复后新测试转绿),而不只是靠一个能通过的测试。这是对外导出、被跨包消费的函数上一次可观察行为的契约变化:任何依赖那个崩溃具体消息/类型的调用方(本代码库中未发现有)现在会看到一个不同的、有文档说明的 `Error`。

本轮修复的 Reviewer 在重新攻击这次修复时,另外发现了一个新的、非阻塞的发现:一个手工构造的 chain,其 root 与 terminal 主体都与 `recorded` 的租户一致,但其中一个中间 hop 携带不同的租户,不会被 `assertRuntimeTenantPolicy`/`TenantMismatchError`(二者只比对 terminal 租户)拒绝,不过它仍会被真实、持久地记入日志(`resolveSessionIdentity` 的 `sameChainShape` 检查会捕捉到逐条目的形状差异,因此 `shouldLog: true`)。这一点已作为既有 root/terminal 端点框架的同伴披露,记在 `chain.ts` 的 `currentTenantId` 文档里,同轮还核实了本包自身测试之外目前没有任何真实调用方读取中间 chain 条目(`isInChain`/`assertInChain`/`assertAgentDelegationValid`)——因此这是一条已披露的局限,而不是一个需要代码修复的活跃 bug。

`decodeStorageRecord` "其余值一律透传、不做校验" 的缺口,对整个 `SessionEvent` 联合类型而言仍然存在,与该函数自身文档已披露的一致——本轮既未关闭它,也未进一步搁置它;未来一次 `dsh-session` 范围内、对整个事件联合类型(或某个高价值子集)做 schema 校验的工作,不受本轮任何决定的影响。
