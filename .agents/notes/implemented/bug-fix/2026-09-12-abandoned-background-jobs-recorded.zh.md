# Agent Note: 不会等待自己后台 job 的 run,得把这件事说出来

Status: implemented

[English](2026-09-12-abandoned-background-jobs-recorded.md) | 中文

## Problem

一次性 run 在它的 agent 变为 idle 时结束,而 `whenIdle()` 不跟随后台 job:job 是一条带生产者 promise 的 `jobs` 记录,归 agent 所有但不驱动它。生产里有两个表面这样结束,并且随后都拆自己。

`packages/bundle/headless/src/index.ts` 等 `whenIdle()`、flush、写结果行、调 `io.exit`。`packages/subagent/subagent-in-process-driver/src/index.ts` 等子 agent 的 `whenIdle()`、读结果,随后父级 dispose 掉 handle。长活表面不一样:ACP 在 `whenIdle()` 结束的是一个 turn,进程还在,迟到的完成仍能落到后一个 turn。

接下来发生的事比丢掉工作更糟。`cancelForTeardown`(`packages/jobs/jobs-local/src/index.ts`)在 cancel **之前**先置 `job.reported = true`,而且是刻意的——正在拆的 owner 不该被唤醒,会唤醒的报告者每拆一层就要花掉一次模型请求。于是被放弃的那一集合被枚举、被标为已送达、被丢弃,恰好在没有任何人能读它的那一刻。事后读会话日志的人看到的是一个被启动、被接受、被报告的 job,以及没有任何记录说它的输出无处可去。

产品的承诺还与此相反。`tool-jobs` 的系统提示词段落告诉模型「job 结束时你会在会话内收到通知」。而在一个以「作答然后退出」为全部目的的 profile 里,先于后台 job 结束是常态而非边缘情况。

## Decision

**在 run 的输出被写出之前读出被放弃集合,两个表面都做。** headless runner 里的 `recordAbandonedJobs` 在 `sessions.flush` 之前列出该 agent 自己的 job;subagent driver 里的 `recordAbandonedChildJobs` 在 `readResult` 之前列出子 agent 的。每一处都记一条 `warn`,点名每一个未到终态的 job。这是让丢失不再无声的最小改动;它不修丢失本身——那是程序队列条目里仍然开着的 drain 方向。

**不进入任何模型请求。** 被放弃的 job 是一次已经产出答案的 run 的运维事实。尤其是子 agent 的结果,它是父级面向模型的输出,原样不动,因此没有任何语料移动:五个起后台 job 的录制场景全部原样回放通过。

**`JobStatus` 的唯一一处分类,从 Service Definition 导出。** `isTerminalJobStatus` 放在 `@deepseek-ai/dsh-jobs`,紧挨它所划分的联合类型。改动之前,同样的三个值在这个包组里已经列了两遍——`jobs-local` 里的一个私有函数和不变式伴生插件里的一个 `Set`——两个新调用点会让它变成四遍。现在两份既有副本都调用该导出。

## Testing

`packages/bundle/headless/tests/headless.spec.ts` 三条,`packages/subagent/subagent-in-process-driver/tests/subagent-in-process-driver.spec.ts` 三条。headless 那几条用一个 `jobs` 桩,因为这个文件拥有的问题是「runner 读不读这个集合、什么时候读」;driver 那几条挂真实的 `dsh-jobs-local`,并给子 agent 一个只有被取消才结算的 job——那正是「拆解时仍存活」这个状态本身。

排序断言是被观测出来的,而不是对着源码断言的:headless 那条用同一个通道记录 warning 与 `session/flush` 事件,并断言 warning 在前。把调用挪到 flush 之后,恰好红这一条。

每个变异红一条、其余绿。删掉 driver 的调用,红那条点名 job 的用例。去掉终态过滤,红两个表面各自的「已结算」控制——这也正是 driver 为什么要有一条已结算用例:它的「无 job」控制检测不到这个变异,而检测不到失败的控制不是控制。

已结算控制会先断言那个 job 确实到了 `completed`,再断言没有记录任何 warning,因此一个没来得及结算的 job 会响亮地失败,而不是让「无 warning」检查变成空转。

## Alternatives considered

**一个会话事件加一条 stderr 投影。** 这是能抵达调用方的路线,而且不便宜:snapshot harness 把 stderr 定义为会话日志的投影(`expect(result.stderr).toBe(stderrFromSession(log))`),所以本改动任何「调用方可见」的那一半都会移动一条由会话派生的期望。那就意味着一个 `SessionEventMap` 成员,外加生成的目录、两个 SDK 的期望输出,以及三个场景的重录。记进队列条目交由 owner 裁定,而不是在这里顺手并进来。

**把被放弃集合报进子 agent 的 `SubagentResult`。** 否决,因为那个值是父级模型的输入:它会把一个拆解事实变成模型可见,并改动每一个录制的 subagent 场景。

**等待这些 job。** 这是真正交付输出的方向,是两个表面的生存期改动,而且需要一个由部署选择的 bound。那是队列条目里单独的裁定,不是本 note 的。

**动 `cancelForTeardown` 的 `reported = true`。** 不动。那一行在它待的位置是对的——正在拆的 owner 不该被唤醒——记录该在更早,在决定何时拆的那些表面。

## Consequences

只有当 exporter 的阈值放行 level 2 时,这条记录才到得了它;没有 `levels` 的 exporter 回落到 `INFO`,而 `warn` 会被过滤掉。所以 exporter 停留在默认值的组合会保留这个事实却不展示给任何人。两个包的 README 都写明了这一点,而不是暗示调用方现在看得见这份丢失。

`@deepseek-ai/dsh-headless` 与 `@deepseek-ai/dsh-subagent-in-process-driver` 新增 `@deepseek-ai/dsh-jobs` 作为 peer dependency。两者都不要求该服务:都通过 `ctx.get('jobs')` 读取,组合没挂注册表时什么也不记——每个 spec 都有一条用例覆盖这种情况。
