# Agent Note: 不会等待自己后台 job 的 run,得把这件事说出来

Status: implemented

[English](2026-09-12-abandoned-background-jobs-recorded.md) | 中文

## Problem

一次性 run 在它的 agent 变为 idle 时结束,而 `whenIdle()` 不跟随后台 job:job 是一条带生产者 promise 的 `jobs` 记录,归 agent 所有但不驱动它。生产里有两个表面这样结束,并且随后都拆自己。

`packages/bundle/headless/src/index.ts` 等 `whenIdle()`、flush、写结果行、调 `io.exit`。`packages/subagent/subagent-in-process-driver/src/index.ts` 等子 agent 的 `whenIdle()`、读结果,随后父级 dispose 掉 handle。长活表面不一样:ACP 在 `whenIdle()` 结束的是一个 turn,进程还在,迟到的完成仍能落到后一个 turn。

接下来发生的事比丢掉工作更糟。`cancelForTeardown`(`packages/jobs/jobs-local/src/index.ts`)在 cancel **之前**先置 `job.reported = true`,而且是刻意的——正在拆的 owner 不该被唤醒,会唤醒的报告者每拆一层就要花掉一次模型请求。于是被放弃的那一集合被枚举、被标为已送达、被丢弃,恰好在没有任何人能读它的那一刻。事后读会话日志的人看到的是一个被启动、被接受、被报告的 job,以及没有任何记录说它的输出无处可去。

产品的承诺还与此相反。`tool-jobs` 的系统提示词段落告诉模型「job 结束时你会在会话内收到通知」。而在一个以「作答然后退出」为全部目的的 profile 里,先于后台 job 结束是常态而非边缘情况。

## Decision

**在 run 的输出被写出之前读出被放弃集合,两个表面都做。** headless runner 里的 `recordAbandonedJobs` 在 `sessions.flush` 之前列出该 agent 自己的 job;subagent driver 里的 `recordAbandonedChildJobs` 在 `readResult` 之前列出子 agent 的。每一处都对每个未到终态的 job 追加一条 `job/abandoned` 会话事件,并记一条点名整个集合的 `warn`。它不修丢失本身——那是程序队列条目里仍然开着的 drain 方向;它做的是让丢失不再无声。

**调用方确实得知了此事,而这需要会话事件而非一行日志。** `warn` 是 level 2,没有 `levels` 的 exporter 回落到 `INFO`,所以只记日志等于保留事实却不展示给任何人。stderr 才是调用方的通道,而录制会话 harness 把 stderr **定义为**会话日志的投影——因此一行日志解释不了的 stderr 会红掉每一个场景。于是事件是机制、那行 stderr 由它派生:`abandonedJobLine` 由 headless bundle 导出、harness 调用它,两种写法无从漂移。

**不进入任何模型请求。** 事件在 turn 结束之后追加、不带 surface 元数据。尤其是子 agent 的结果,它是父级面向模型的输出,原样不动。

**追加事件的不是注册表,是那些表面。** 只有表面知道一次 run 正在结束,而 `cancelForTeardown` 跑在 fiber 拆解时——那时 headless runner 早已写完结果。

**`JobStatus` 的唯一一处分类,从 Service Definition 导出。** `isTerminalJobStatus` 放在 `@deepseek-ai/dsh-jobs`,紧挨它所划分的联合类型。改动之前,同样的三个值在这个包组里已经列了两遍——`jobs-local` 里的一个私有函数和不变式伴生插件里的一个 `Set`——两个新调用点会让它变成四遍。现在两份既有副本都调用该导出。

## Testing

一个新的录制场景 `snapshots/session/background-job-abandoned`,外加 `packages/bundle/headless/tests/headless.spec.ts` 三条与 `packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts` 三条。

**这个场景之所以必须造,是因为语料根本显示不出这个缺陷。** 逐个 `replay.override.json` 量过:三个场景起后台 job,两个用 `job_output(wait: true)` 兜住,第三个把自己的 job 杀掉——而 `kill()` 在改状态前就把记录标为已报告。没有任何一次录制的 run 以存活的后台 job 结束,所以缺陷和它的修都不可观测。新场景在一次 run 里起两个真实的后台 Bash 进程:一个会结束并被收取,一个永不结束。它的 fixture 恰好带一条 `job/abandoned`,点名第二个——被收取那个的缺席就是那条控制,它让事件是关于「存活」而不是关于「起过 job」。

场景上两个变异,各有各的红法:去掉 runner 的 stderr 写入 → 红 stderr 投影;去掉追加 → 红日志比对。headless 那几条用一个 `jobs` 桩,因为这个文件拥有的问题是「runner 读不读这个集合、什么时候读」;driver 那几条挂真实的 `dsh-jobs-local`,并给子 agent 一个只有被取消才结算的 job——那正是「拆解时仍存活」这个状态本身。

排序断言是被观测出来的,而不是对着源码断言的:headless 那条用同一个通道记录 warning 与 `session/flush` 事件,并断言 warning 在前。把调用挪到 flush 之后,恰好红这一条。

每个变异红一条、其余绿。删掉 driver 的调用,红那条点名 job 的用例。去掉终态过滤,红两个表面各自的「已结算」控制——这也正是 driver 为什么要有一条已结算用例:它的「无 job」控制检测不到这个变异,而检测不到失败的控制不是控制。

已结算控制会先断言那个 job 确实到了 `completed`,再断言没有记录任何 warning,因此一个没来得及结算的 job 会响亮地失败,而不是让「无 warning」检查变成空转。

## Alternatives considered

**只记日志。** 本改动的第一个形态,它到不了调用方:`warn` 被默认 exporter 过滤掉,而一次性 run 里没有任何东西会在进程离开前把缓冲区排空。它仍与事件并存,因为进程内观察者——嵌入本 bundle 的宿主——不必解析日志就能读到它。

**把被放弃集合报进子 agent 的 `SubagentResult`。** 否决,因为那个值是父级模型的输入:它会把一个拆解事实变成模型可见,并改动每一个录制的 subagent 场景。

**等待这些 job。** 这是真正交付输出的方向,是两个表面的生存期改动,而且需要一个由部署选择的 bound。那是队列条目里单独的裁定,不是本 note 的。

**动 `cancelForTeardown` 的 `reported = true`。** 不动。那一行在它待的位置是对的——正在拆的 owner 不该被唤醒——记录该在更早,在决定何时拆的那些表面。

## Consequences

`SessionEventMap` 增加一个成员,因此 `docs/persistence-catalog.md` 与 `packages/core/session/src/known-event-types.ts` 重新生成。没有任何 SDK 期望输出改变:实测 `snapshots/sdk/` 与 `snapshots/acp/` 下没有场景以存活的后台 job 结束,也没有 SDK 表面枚举这套事件词汇。

`warn` 仍与事件并行发出,仍会被默认 exporter 过滤。它是给进程内观察者的便利,不是那条记录——记录是事件,以及由它派生的那行 stderr。

`@deepseek-ai/dsh-headless` 与 `@deepseek-ai/dsh-subagent-in-process-driver` 新增 `@deepseek-ai/dsh-jobs` 作为 peer dependency。两者都不要求该服务:都通过 `ctx.get('jobs')` 读取,组合没挂注册表时什么也不记——每个 spec 都有一条用例覆盖这种情况。
