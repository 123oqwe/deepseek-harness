# Agent Note:workflow 定义的身份包含它可以做什么;而一个未解析就传下去的哨兵值让嵌套 run 彻底停摆

Status: implemented

[English](2026-09-09-definition-identity-covers-authority-and-the-zero-sentinel.md) | 中文

## 问题

P4-09 must[3] 要求嵌套 workflow run 像已经衰减 budget 与 worker limits 那样,继承并**衰减** capability token。两处在写代码之前完成的测量,改变了这句话的含义。

**嵌套 run 没有自己的会话。**`startNested` 准入后以 `parent: parent.parentAgent` 启动它——与上层 run 是同一个 `Agent`;整个 `workflow-worker-thread` 里没有任何地方为 run 创建会话。模型工作发生在下一层:`startChild` 调用 `subagents.start(...)`,**那个 child** 才拿到会话,而这条路径 P2-02.U 已经接好了 `deriveChild`。所以本片原打算添加的派生早已在跑;真正没发生的是衰减——`startChild` 不传 `toolFilter`,嵌套 run 的子拿到的东西与根 run 的子一模一样。

**digest 只覆盖 body。**`computeDefinitionDigest` 只哈希 `body`;声明也搭不了 `meta`:它是封闭字段集、走**请求**字段,而 `assertBodyParses` 会拒绝含 `export const meta` 的 body。把声明存在 digest 之外,意味着同一份 body 可以换个名字、带更宽的声明重注册而 digest 不变,由它派生的界因此可被重注册放宽。

## 决定

**定义的身份 = 它是什么 + 它能做什么。**`RegisteredDefinition` 增加 `tools?: DefinitionToolDeclaration`,`computeDefinitionDigest(body, tools)` 以规范化编码哈希两者:`allow` 去重并排序,每一段都加长度前缀,使拼接无歧义。顺序与重复不改变身份,内容才改变。这是格式变更——所有已注册 digest 都会变——按仓库 pre-release 立场,这优于留兼容垫片。

**缺席**的声明与**空**声明刻意产生不同的 digest,因为二者含义相反:缺席 = 继承父 run 的界,`[]` = 该 run 不得使用任何工具。若编码相同,最严格的声明将无法表达,因为它会被读成"继承一切"。

`inheritToolBound` 逐层取交且只会收窄:命名一个祖先已经放弃的工具,什么也得不到。host 在每次 `subagents.start` 上以 `toolFilter` 施加 run 的界,通到已有的 `deriveChild`。`ChildStartRequest` 不增加该字段——这个请求是**从 worker 跨端口上来的**,让脚本命名自己的过滤器就是让它自选权限。

**subagent 是一条归属规则,不是自成一层的重试或权限层**——这一条在同一场会话中由测量得出并记入 P4-11 的 preFlight,也正是"界属于 run 而不属于子请求"的理由。

## 备选方案

**在 `workflow()` 调用处由调用方声明,再与父界取交。**暂时否决:`NestedStartRequest` 不携带声明,因此第一版在深度 1 处衰减不出任何可测量的东西,用于证明它的用例将观测"两个相同集合取交"——正是 4.4a 要拒的形状。它日后可加,must[3] 不需要它。

**把 `tools` 作为 digest 之外的兄弟字段。**基于测量否决:那正是上文"可被重注册放宽"的洞。

**不存界,改为从父的活 token 现算。**否决:被恢复的 run 没有活着的父,而界必须能挺过一次中断(见下)。

## 同一次改动里关掉的 `resume` 放宽

`resume` 以不带 `nested` 的方式启动,于是被恢复的 run 拿不回祖先链、衰减预算,也拿不回界。前两者是长期存在的松弛;界的丢失则是**放宽**——被中断的嵌套 run 回来后能使用它的定义排除掉的工具。三者缺失出于同一个原因:没有任何东西持久化它们。`WorkflowJournal` 增加 `nesting?: RunNesting`,写在 run 自己的持久记录里并由 `resume` 读回;recorder 回退到种子的 nesting,以免恢复后第一次持久化就抹掉刚刚恢复的状态。

## 零哨兵:嵌套 run 根本无法起 agent

`maxConcurrentAgents: 0` 是**哨兵值**,意为"由宿主推导",且只在根路径上被解析。`startNested` 把**配置原值**当作父限值传下去,`inheritWorkerLimits` 原样复制,而 `nested?.limits.maxConcurrentAgents ?? …` 救不了它,因为**零不是 nullish**。嵌套 worker 于是以并发上限零启动:宣告 ready,然后永远等待一个不可能存在的槽位。没有错误,没有子,没有结果。

六条嵌套用例一直全绿,因为没有一条在嵌套 run 里 spawn 过 agent——于是所有以嵌套为前提的子句(acceptance[0]–[3]、must[3] 的 budget/token/trace 衰减)都建立在一条无人核过的性质上。现在哨兵只在 `resolvedConcurrency()` 中解析一次,两个调用点共用。

**这是 [`AGENTS.md`](../../../../AGENTS.md#conventions) 那条"包边界上显式优于隐式:defaulting 是显式的 `resolve(request): Spec` 步骤,绝不是藏在 `run()` 里的 `?? default`"的反例。**此处的 defaulting 隐藏了两层:哨兵的含义只存在于 `launch` 里的一个表达式中,而回退用的 `??` 被一个零直接穿过。点名它才是要点:这不是运气不好,而是那条规则预言过的失效方式。

把它隔离出来用了四次探针,每次只改一个变量:嵌套 run 不调 `agent()` 通过;嵌套 run 调 `agent()` 且无声明挂死;**根** run 调 `agent()` 通过;嵌套 run 调 `agent()` 且完全不挂 token 插件仍挂死。第四次把 capability token 彻底排除在外。

## 影响

[`nested-run.spec.ts`](../../../../packages/workflow/workflow-worker-thread/tests/nested-run.spec.ts) 中九条用例守住它,包括"嵌套 run 能 spawn 并结算"这条基础性质、声明收窄真实子会话的 token,以及深度 2 的交集——深度 1 展示不了它,因为只有一层声明时,取交与赋值无法区分。[`registry.spec.ts`](../../../../packages/workflow/workflow-registry/tests/registry.spec.ts) 中四条用例守住身份:更宽的声明改变 digest,重排与重复不改变,缺席不同于空,而 digest 未覆盖其声明的注册会被拒绝。

**两条验证教训,都是在此测出来的,不是推想的。**

跨包签名变更需要**仓库级** `typecheck`。包内 `tsc` 通过 project reference 把工作区导入解析到可能陈旧的 `lib/types`,于是按旧签名放行;vitest 剥掉类型,缺失的实参变成 `undefined`,其行为恰好等于"无界",测试照样全绿。两层都漏掉了一个"七参函数被传五个参数"的调用,只有仓库级门禁抓到。

在一个**通过**的用例里,`console.error` 探针什么也证明不了——本仓库的 vitest 不为通过的用例转发 console 输出,所以"它没打印"不是证据。必须先在已知会触达该代码的用例上证明探针会打印,之后它的沉默才能当作结果;用 `appendFileSync` 写文件才让这些探针真正有效。
