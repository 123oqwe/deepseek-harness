---
description: "快照 composition 的后台作业结算观察者,供语料作者把 mock 子进程严格排在作业结算之后。"
kind: "package-reference"
---

# @deepseek-ai/dsh-job-settle-signal

[English](README.md) | 中文

## 概述

`dsh-job-settle-signal` 在后台作业进入终态时写出一个文件,于是阻塞到该文件出现为止的 mock 子进程就严格运行在这次结算之后。它存在的理由是:作业自己的生产者写出的任何文件都无法建立这个次序——生产者在注册表结算该作业之前就已结束,所以生产者写出的标记之后仍留有一段窗口,消费者仍可能先赢。只有注册表完成通知的观察者位于结算之后,本插件就是这个观察者。它不注册工具、不产生任何 session 事件、不改变任何产品插件的决定。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把它挂在快照 composition 里,与那个必须排在作业结算之后的 mock 并列,并让该 mock 指向同一路径。

```yaml
- id: job-settle-signal
  name: '@deepseek-ai/dsh-job-settle-signal'
  config:
    file: !!js "process.cwd() + '/job-settled'"
    jobId: subagent-1
```

`file` 必填。`jobId` 可选:当 composition 恰好只启动一个作业、且第一次结算就是目标结算时可以省略。文件内容是结算作业的 id 与状态,因此若屏障错误地由另一个作业释放,仅凭该文件即可诊断。

挂载本插件的 composition 必须在其 fixture 说明里点名这一点,并写明它钉的是哪个竞态——见[快照语料规则](../../../snapshots/AGENTS.md)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`apply` 通过 `ctx.effect` 注册一个 `jobs.onJobDone` 监听器,注册随 fiber 一同释放。监听器同步写文件;正是同步写使这个信号可以当屏障用,因为等待方子进程轮询文件是否存在,绝不能观察到一个写了一半的路径。

`file` 为空或缺失时在加载期抛错,而不是退化成空操作。空操作会让等待方子进程一直阻塞到它自己的超时,故障会表现为一个远离错误配置的、无法解释的挂起。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [快照语料归属与 composition 规则](../../../snapshots/AGENTS.md)
- [`@deepseek-ai/dsh-jobs`](../../jobs/jobs/README.zh.md) —— 本包观察其完成通知的注册表
- [测试策略](../../../docs/testing.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

无。本插件不贡献工具、不贡献提示词文本、不产生 session 事件,因此它所做的一切都不会进入模型请求。

#### KV 缓存影响

无;它既不改变请求前缀,也不跨运行保留状态。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了何时需要特别小心使用该观察者。它们是当前的包约束,不是任务清单。

- **信号是单向的且从不清除** —— 需要释放两次屏障的 composition 得用两个路径;同一目录中上一次运行遗留的旧文件会立刻释放屏障。
- **被观察的是结算,不是投递** —— 该文件表明作业进入了终态,并不表明由此派生的任何通知已被投递,因此建立在它之上的屏障只保证「排在结算之后」。
- **仅限测试支持** —— 本包为 `private`,只服务于快照语料,不属于任何出货 profile。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 —— 点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件名、注入声明、`Config`,以及写出信号的 `onJobDone` 监听器 |
| — | 不发布运行时不变量伴生入口;本测试支持包不拥有生产事件流或可变数据,它唯一可观察的关系就是它写出的那个文件,由消费它的场景断言。 |

</details>
