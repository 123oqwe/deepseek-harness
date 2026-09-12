# Agent Note: 一次性 run 会等自己启动的 job,上界由部署选择

Status: implemented

[English](2026-09-12-a-one-shot-run-waits-for-the-jobs-it-started.md) | 中文

## Problem

一次性 run 在它的 agent 变 idle 时结束,而后台 job 不在这个条件里。上一笔改动让丢失变得可见——每个被放弃的 job 都有一条 `job/abandoned` 事件和一行 stderr——但可见不等于送达。产品告诉模型 job 结束时会收到通知,而在一个以「作答然后退出」为全部目的的 profile 里,先于 job 结束是常态。

有两个表面这样结束:headless runner,随后进程离开;以及进程内 subagent driver,父级在读完结果后随即 dispose 掉子 agent。

## Decision

**两个表面在读自己的结果之前都会等,上界是一个 config 字段。** headless bundle 的 `Config` 上是 `waitForJobsMs`,两个进程内 subagent provider 的 `Config` 上也是,经 `InProcessRunOptions` 传下去——driver 是库,不为部署该选的东西设默认值,与 `dsh-shell` 的 request/spec 切分同一套。默认 30 秒,`0` 仍然可表达:调用方的墙钟可以为它没要求等待的工作被占用多久,是部署的问题,不是这段代码的问题。

**drain 观察 `onJobDone`,绝不用 `jobs.wait(...)`,而整个改动就转在这个决定上。** 一个登记在册的 waiter 会让注册表把该 job 标为已报告:`jobs-local` 的 `settle` 只要 `waiters > 0` 就置 `reported`,而 `wait` 返回时再标一次。`reported` 正是投递路径所查的东西。用等待来 drain 会产出这样一次 run:等得很正确、没记任何放弃、而模型什么也没看见——正是 drain 要防止的那种失败,却穿着成功的样子。观察者不登记 waiter,因此 `tool-jobs` 照常投递。

**集合取读点那一刻存活的那一份,其后由同一个 deadline 覆盖一切。** 一次完成可能唤醒一个 turn,而那个 turn 又起一个 job;等到「没有东西在跑」为止会让这条链把等待无限延长。同一个 deadline 也覆盖某次完成打开的那个 turn,因为一次等了自己的 job、却在它们的答案到达之前就打印的 run,等于白等。

**超时停止的是等待,绝不是 job。** 超时取消会把一个慢 job 变成被杀的 job,而那本来就是拆解会做的事;调用方需要的是得知工作被丢弃,而既有的记录已经这么说了。

**wake 预算在 drain 内不适用。** 预算约束的是一段对话里的自激链——被唤醒的一轮启动了那个其完成又唤醒它的 job——而一次已在收尾的 run 不会再启动任何东西。没有这条豁免,耗尽的预算会把 drain 中的完成路由到 `inject`,那里没有人认领,于是把一种静默换成另一种。

## Testing

三个单元,每个都先 RED 后 GREEN,每个变异各红自己那一条。

`tool-jobs` 拥有这条豁免,三条用例:预算耗尽时窗口内的空闲 owner 仍被唤醒;窗口外预算照旧生效;只有正在被 drain 的那个 owner 被豁免。忽略窗口三条全红。把预算**清零**而不是绕过的那个变异只红第一条,而且只因为那条用例结尾检查了窗口前的花费仍然算数——没有那个尾巴,绕过与重置无从区分,而一个会重置预算的 drain 会让一段对话重新获得自我唤醒的能力。

两个表面各有正反一对:在上界内结算的 job 不记任何放弃;上界到期则记下它留在运行中的东西、且不杀它。不等会红第一条;超时取消会红第二条。

`wait()` 的抑制没有单独给变异。它是两处代码读数,而 `jobs-local` 已经冻结了 waiter 那一半(`resolves with the terminal snapshot when the job settles, marked reported`);在这里再造一个合成变异,只是重述一条已经有主的性质。

## Alternatives considered

**由 `tool-jobs` 提供一个承载窗口的服务。** 最初的形状,它过不了组合这一关:两个作用域化的 `tool-jobs` 挂载共享一个注册表——正好有一条冻结用例——而 `ctx.provide` 拒绝第二次注册。阶段因此移到 `@deepseek-ai/dsh-jobs`,以 Agent 实例为键,而表面与投递插件本来就都依赖它。**规则**仍留在 `tool-jobs`:本包只声明一次 run 正在结束,不声明那对一条通知意味着什么。

**在一次性 profile 上把 `maxConsecutiveWakes` 配高。** 否决:那是绕过规则而不是陈述规则,而且耗尽的预算仍然路由到 `inject`,丢失换个形状回来。

**一直 drain 到没有东西在跑。** 没有终止性论证:一次完成唤醒一个 turn、那个 turn 又起一个 job,等待就会无限延长。

## Consequences

当一次性 run 留下了仍在跑的 job 时,它现在最多多花 `waitForJobsMs`。这正是目的,而 `0` 精确恢复旧的时序。

`snapshots/session/background-job-abandoned` 把上界设为 100 毫秒。它的主题是那条记录,它的 job 永不结算,而在出厂默认值下它会为了到达同一个状态把整套挂住三十秒。写这个覆盖时撞出一个值得知道的 loader 细节:一个 patch 条目的 `config` 是**替换**bundle 的那一份,而不是并进去,所以必填的 `task` 必须重新给一遍——第一次尝试直接以 `$.task missing required value` 启动失败。
