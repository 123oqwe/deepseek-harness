# Agent Note: 只有两边都有 lease 代撑着时,预留才是排他的

Status: implemented

[English](2026-09-12-ledger-reservation-fencing.md) | 中文

## Problem

`decideReservation`(`packages/action/action-ledger/src/index.ts`)会把一条 `prepared` 记录授予任何 epoch `>= existing.epoch` 的调用方。严格更高的 epoch 必须如此:围栏证明前一个持有者已经出局,这正是 must[3] 的恢复路径。但在**同一个** epoch 上,持有者是一个活着的对等方,授予它就让两个 worker 同时持有一条预留——正是 P4-12 must[2] 要禁止的状态,而且是账本自己造出来的。

这个缺陷有两个彼此独立的隐身理由,两个都值得记下来。

**并发用例报的是调度,不是不变量。**`store.spec.ts` 的双进程用例断言一个 `reserved` 与一个 `duplicate`。输的那一方只有在赢的一方**已经发送**之后才可能看到 `duplicate`,而发送不在预留那笔事务里:`reserve` 在 `BEGIN IMMEDIATE` 下覆盖读与写,然后 `reserveExternalEffect` 把 `markSent` 作为第二条语句调用。当输方的事务落在赢方 `COMMIT` 与其发送之间的缝隙里时,它读到的是自己 epoch 上的 `prepared`,于是拿到了同一条预留。同一个 SHA 上,run 34666554965 绿,run 34667961832 红。

**一条被冻结的对照用例把缺陷钉成了需求。**`idempotency.e2e.spec.ts` 的 `admits the SAME epoch, so fencing refuses only what is genuinely behind` 本是用来对照「围栏拒绝一切」的。它的 entry 助手默认 `state: 'prepared'`,所以它真正冻住的是「与持有者同代的对等方可以拿走这条预留」。一条对照用例需要的是围栏确实已经越过的那个代,也就是更高的那个。

**在这两者之下,调用点把问题本身抹掉了。**`epochOf` 返回 `brandNumber<LedgerEpoch>(agent.lifecycle?.epoch ?? 0)`。只有 `RunPlugin` 会赋 `agent.lifecycle`,所以任何不挂载 Run Service 的组合里,每一次 run 都以 epoch `0` 预留——并且与其他所有这样的 run 递交同一个代。对这些 profile 来说 must[2] 不是偶发,而是根本不可达,而且没有任何地方说出这件事。

## Decision

**`'unfenced'` 是一个状态,不是数字零。**`LedgerGeneration = LedgerEpoch | 'unfenced'`,请求、记录与存储三处都带着它。当 agent 没有 lifecycle 时,`generationOf` 返回 `'unfenced'`,而不是退化成零。每一次代的比较都要求**两边**都有代:unfenced 的调用方在这个序之外,而不是序的前面,所以它既不会被判 stale,也不会被当成对等方。

**与持有者同代的对等方以 `held-at-same-epoch` 被拒,并点出持有它的那个代。**这条理由是新的,因为既有的两条在这里断言的都不成立:`duplicate` 断言副作用已经发生,那会让调用方放弃一个根本没人执行过的副作用;`stale-epoch` 断言存在一个并不存在的后继者。一个说「等」,另一个说「停」。

**unfenced 的预留照样授予,但要贴上标签。**只要有一边没有围栏,账本就重新接管这条 `prepared` 记录,因为没有东西能证明持有者已经消失,而拒绝会把一个从未发送过的键永久搁死——没有代的时候,at-least-once 才是能保住的那条保证。`reserved` 决定带上 `fenced`,审计就能读出它是按哪条规则放进来的。一个围栏完好的调用方去接管一条持有者本身 unfenced 的记录,结果是 `fenced: false`:旧持有者仍然可能发送,围栏是这一**对**的属性,不是调用方的属性。

**存储把这种缺席持久化,而不是编码成别的东西。**`epoch` 列可为空,NULL 表示 unfenced,`SCHEMA_VERSION` 为 2,更旧的文件在 open 时就被拒绝,并点出路径与两个版本号。每一次状态迁移都用 `epoch IS ?` 而不是 `=` 匹配,因为 `NULL = NULL` 为假,而 `=` 会拒绝刚被告知自己持有预留的那个调用方的每一次写入——实测出来的报错是 `is held by epoch unfenced, not unfenced`。

## Testing

`spec/first100/exec/command-freeze.json` 里有三条冻结条目被取代,每条都带着该 cell 当前完整的用例清单与它自己的变异证明。没有任何一条登记进 `frozen-title-renames.json`:断言相反准入结果的替换是属性变更,登记成改名等于告诉解析器「标题只是挪了位置」。

双进程用例现在**停在预留处**、不再发送,这正是它的答案变得确定的原因:must[2] 关心的是两个 worker 同时**持有**一条预留,把发送包进来只会让输方拿到的理由变成调度的函数。它诚实的孪生用例断言两个 **unfenced** 进程**都**拿到预留——这是没有 lease 的 profile 得不到的排他性,写下来,而不是留给读者从一次重复的外部副作用里自己发现。

每个变异都只让自己套件里的用例变红、其余保持绿:删掉对等方拒绝,让契约阶段 22 条里的 2 条红;把迁移的匹配写成 `=`,正好让 unfenced 持有者的迁移那条红;把 `'unfenced'` 映射成 epoch 0——也就是修复前的调用点——正好让 unfenced 的 at-least-once 那条红,因为那次重试于是被当成自己的对等方拒掉,一个从未发出的副作用再也发不出去。

崩溃演练自身的弱点是在验证本次修复时量出来的,**没有**在这里修。它的 LCG 在双精度浮点里求值,所以从第二次迭代起乘积就超过 2^53、低位丢失,崩溃点在 10000 次迭代里有 9956 次是 `none`、43 次 `after-reserve`、1 次 `after-send`、`after-receipt` 一次都没有。这次演练之所以通过本次改动,是因为它几乎不崩。修它与「代」纠缠在一起——一次真的在预留之后崩掉的演练,需要每次尝试递交一个新的代,而 `attempt` 现在正好接受它——所以它被记进 program 的 BLOCKED 队列交由 owner 裁决,而不是悄悄一并改掉。

## Alternatives considered

**拒绝对 `prepared` 记录的每一次重复预留。**这是第一次尝试的修法,它破坏 must[3] 的恢复:一个在发送之前崩掉的代会永久持有它的预留,那个副作用永远不会发生。三条被冻结的用例变红,补丁撤回,条目里记着这件事。

**保留 `?? 0`,把 epoch 0 当作「没有 lease」。**最便宜的改法,也是缺陷的根。哨兵值让每个没有 lease 的调用方都与其他所有这样的调用方同代,于是账本分不清对等方与重启,只能给两者挑同一个答案:拒绝,则 at-least-once 丢掉;准入,则 must[2] 空转。把这种缺席命名出来,才让两条规则成为两条规则。

**unfenced 的调用方重新接管时保留记录原有的代,让围栏永不被降低。**很有吸引力——它让那一行始终带着一个真实的代——但它让这条预留无法使用:迁移按记录上的代匹配,于是刚被授予预留的调用方记录不了自己的发送。记录改为带上**新**持有者的代,unfenced 也包括在内,降级则改由决定本身报出。

**把事务延长到覆盖发送,这样双进程用例原来的断言就成立。**否决:发送是一次外部请求,跨着它持有 SQLite 写锁会把进程里每一次外部副作用串行化,并把其他键堵在一次网络调用后面。修复属于事务已经覆盖的那个决定。

**把 `fenced` 带进一条新的 session 事件。**今天审计是从 `action/manifest-appended` 缺少 `leaseEpoch` 读出 unfenced 的,这覆盖了调用方自身的状态。它区分不出的是:一个有围栏的调用方接管了一条 unfenced 持有者的记录。新事件意味着 `SessionEventMap` 变更,并要附上两个 SDK 的期望输出,所以这个缺口记在包 README 与队列条目里,而不是从这里关掉。

## Consequences

同代的重试不再执行副作用。崩溃之后的推进来自下一个代——Run Service 正是这样发给替补进程的;用自己这个代重试的调用方会被告知 `held-at-same-epoch`,副作用保持未发送,而不是被发两次。

`sdk-minimal` 不挂载 Run Service,所以那里每一次预留都是 unfenced 的:at-least-once 成立,must[2] 不成立,现在决定本身与包 README 都这么说。叠在 `dsh-base` 上的四个 profile 是有围栏的,因为 `dsh-run` 在那里启用,而 `run/src/index.ts` 会从它取到的 lease 里赋 lifecycle 的 epoch。

更旧的构建写出的 `action-ledger.sqlite` 在 open 时被拒绝,而不是迁移,这符合预发布立场。拒绝信息点出文件与两个版本号;删掉它就是开一本新账本。

`ReserveDecision` 的 `reserved` 分支多了一个必填字段,所以每一个构造它的消费者——存储与测试——都要说出是哪条规则准入的。这正是目的:一个对所有情况都说 `fenced` 的决定,或者把它留给调用方自己推断,都不携带任何信息。
