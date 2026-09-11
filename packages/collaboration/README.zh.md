---
description: "collaboration 分组导览：多个工作者共享工作时遵循的规则——一个工作项只有一个所有者、一条消息只产生一次副作用、学到的东西写在别人读得到的地方，供使用者与维护者在分组内导航。"
kind: "package-group"
---

# packages/collaboration

[English](README.md) | 中文

## 概述

collaboration 分组是"不止一个工作者共享工作时所遵循的规则"。四个问题,各有一个包居于中心:**这个工作项归谁**(一份租约,其 epoch 由每次状态写入出示)、**这条消息是否已经产生过副作用**(一条去重键,两端以同一方式套用)、**这个任务归谁做**(原子的单赢家领取),以及**我们学到了什么**(一块结构化事实板,从不是自由散文)。另外两个负责顺序:哪条控制消息更紧急,以及一个工作流停下时走到了哪里。这里每个包都在宿主侧、都不注册工具;模型能观察到的只是它的活有没有跑,而不是这些协调。

每个包自己的 README 位于下一层目录,目前只有英文版,这也是下面那些名字没有做成链接的原因:否则本页就会声称存在一个并不存在的中文对应页。

## 目录

- [包](#packages)
- [尚未抵达的部分](#what-is-not-arrived-yet)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| `lease-contract` | Epic P4-07 的权威模型:工作项与 epoch 身份、每次状态写入携带的 fencing token、过期判据,以及拒绝 | —（Service Definition;provider 在 `packages/run`） |
| `intake-dedup` | Epic P4-06 唯一的去重规则 —— `(source, message id, epoch)` —— 由消息总线与 subagent intake 共同套用 | —（一个库;键推导与一个决策） |
| `taskboard` | Epic P5-11 的领取决策:带单调尝试计数的原子单赢家领取,外加在开工前拒绝成环的图检查 | —（决策与存储契约;SQLite provider 是 `packages/run/taskboard-sqlite`） |
| `blackboard` | Epic P5-11 的共享事实板:一条事实是结构化值或工件引用,从不是自由散文,且每条事实都可追溯到它的写入方 | — |
| `control-priority` | Epic P5-10 唯一的优先级表,由 subagent 控制路由与 agent inbox 共用,使两套排序不可能互相矛盾 | — |
| `workflow-journal` | Epic P4-08 的逐步记录 —— 脚本摘要、程序计数器、工件引用 —— 以及由它支撑的步级恢复 | — |

租约是本组的承重思想,也是其中好几个是**契约**而不是实现的原因。**权威是存储签发的一个 epoch**,从不是时间戳、也从不是调用方自选的数字,于是"我的领取过期了吗"与"是否已被别人拿走"成为同一个问题 —— 问存储,而不是问两个宿主无法就其达成一致的时钟。

-----

<a id="what-is-not-arrived-yet"></a>
## 尚未抵达的部分

取自各包自己的 Known Limitations —— 本组格外多的是"provider 或调用方在别处、甚至尚不在任何地方"的契约。

- **租约契约没有回收通知。** 一个被 fence 掉的持有者,只有在它下一次写入被拒时才知道自己失去了这个工作项。
- **`setAvailable` 是一个开关,不是健康检查。** 调用方可以声明某个存储不可达;这里没有任何东西去探测它。
- **今天没有任何东西从任务板调度**,也**没有任何东西清扫失效的领取**:`release` 会立刻释放任务,而一个直接停掉的持有者不会。
- **事实板没有保留策略,信任是一视同仁的。** 事实会累积;来自任何写入方的事实都以同样条件被接纳。
- **`intake-dedup` 不持有状态** —— 已见集合归调用方,这是刻意的,因此本模块对它住在哪里不持意见。
- **没有任何生产者把 `cancel` 标进 inbox**,所以 `control-priority` 里最紧急的那一类没有写入方。
- **`workflow-journal` 的 `receiptsToReconcile` 没有生产调用方**,而它的压缩有调用方却没有可观测的节省。

-----

<a id="related-documentation"></a>
## 相关文档

- [Core 子系统](../../docs/subsystems/core.zh.md) —— `ctx.leaseStore`(取自 `lease-contract`)与 `ctx.taskStore` 的权威契约,以及租约所授权的那些 `Agent` 字段。
- [Workflow 子系统](../../docs/subsystems/workflow.zh.md) —— journal 被读取之处:步级恢复,以及重启的 worker 从中重建了什么。
- [Subagent 子系统](../../docs/subsystems/subagent.zh.md) —— 与 agent inbox 共用 `control-priority` 那张表的控制路由。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文:开放问题与尚未定下的方向。它明确不具权威性 —— 已发布的行为与边界位于上面各节以及每个包自己的 README 中。

本分组尚未定下的开放问题是 **什么算一个工作项**。在 `@deepseek-ai/dsh-run` 里租约的工作项是会话,在工作流 worker 里是一次工作流运行,对各自的调用方都对 —— 但一个跨会话的 Run 会需要第三种,随后还要一条"一次写入出示哪一个"的规则。`BLOCKED-196` 持有这个问题,连同它背后的测量。

第二个问题是 **持有者如何得知自己失去了它**。今天的答案是"在它下一次写入被拒时",正确但晚:一个宿主可能在发现之前,已经为它不再拥有的工作花掉一次模型调用。通知需要存储主动推送,而契约刻意不向 provider 要求这一点。

</details>
