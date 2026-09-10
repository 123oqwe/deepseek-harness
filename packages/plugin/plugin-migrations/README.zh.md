---
description: "Epic P1-10 的插件数据迁移词汇与决策:manifest 的迁移 DAG、前置条件、备份策略与回滚支持,以及在其之上的纯判断——是否无环、路径是否可走、是否可逆、快照是否可对账。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-migrations

[English](README.md) | 中文

<a id="summary"></a>
## 概述

`dsh-plugin-migrations` 承载一个插件的 manifest 就"如何升级它自己的持久数据"所作的声明,以及在该声明之上的决策:这些迁移是否根本可以排序、哪些步骤能把已安装版本带到当前版本、这条路径能否撤销,以及一份快照是否与它声称覆盖的数据对得上。

每个导出都是纯函数。这里没有 I/O,也没有服务。

<a id="table-of-contents"></a>
## 目录

- [本包刻意不做的事](#what-this-package-deliberately-does-not-do)
- [must[2] 判定"欠一次审批",而目前无人去问](#must2-decides-that-approval-is-owed-and-nothing-asks-yet)
- [Model Experience](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-this-package-deliberately-does-not-do"></a>
## 本包刻意不做的事

**它不执行升级。** Epic P1-10 的 must[1] 点了六个阶段——冻结、快照、隔离区迁移、校验、原子切换、健康检查——那是一组作用在真实副作用上的次序。一个能执行其中任何一步的模块,就会成为升级发生的第二个地方;事务属于 Provider 阶段。

**它不判定前置条件。** 迁移的前置条件被原样报回调用方,因为本包无从知道磁盘是否可写、外部系统是否可达。一个被默默当成已满足的前置条件,会让升级建立在没有任何人作出的假设之上。

**它不碰工作区文件。** `PluginDataSnapshot` 覆盖的是插件自己的持久数据、配置与 schema。工作区路径是**被拒绝**的输入,而不是"暂不支持":P3-11 拥有工作区检查点,而 manifest 的备份策略正是两者最容易混淆的地方。

<a id="must2-decides-that-approval-is-owed-and-nothing-asks-yet"></a>
## must[2] 判定"欠一次审批",而目前无人去问

`requiresApprovalAndExport` 回答的是:一次不可逆升级是否欠一个人工决定与一份导出。它**不去索取**,而这是量出来的界限,不是分阶段的方便之计:[`@deepseek-ai/dsh-user-approval`](../../interaction/user-approval/README.zh.md) 的请求携带 `toolName`,并且**在没有开启的 turn 之外会抛错**,而插件升级是一条 CLI 命令,两样都没有。那个拒绝不是可以绕开的疏漏——它保护的是 `approval/asked` + `approval/decided` 这对审计记录,否则重启后读到的就是崩溃残尾。

可逆性读的是迁移**自己的声明**,而不是从备份策略推导,因为二者回答的是不同问题。快照让**数据**可恢复;可逆性问的是这次迁移的影响是否局限在那份数据里。一个同时改写了外部系统的迁移,无论快照多好都是不可逆的,而 must[2] 正是为这种情形存在。

<a id="model-experience"></a>
## Model Experience

无 model 可见面。本包不注册工具、不贡献提示词文本、不发出会话事件。token 与 KV-cache 影响:无。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- **目前没有任何东西消费这些决策。** 这是 Contract 阶段:词汇与判断已存在,而运行它们的事务属于 Provider 阶段。读者不得把这些测试当作"任何升级是事务性的"的证据。
- **must[2] 的审批没有提问者。** 上文已记:现有 approval 缝无法服务一条无 turn 的 CLI 升级。由哪条缝去问是一个未决裁定——无 turn 的审计路径、让升级跑在一个会话内、或把审批那半定向出去——它决定 must[2] 是否在本 epic 内收口。
- **`refuseOutsidePluginStorage` 比较的是已解析的路径。** 它自己不做解析,因为解析要读文件系统。调用方若传入未解析的 `../` 路径,比较的就是"看起来不是那个意思"的字符串;先解析再调用是调用方的义务,也是 Provider 阶段要履行的。

<a id="dev-note"></a>
## 开发备注

环是被**结构性**拒绝并被点名的,而不是靠深度上限撞出来的。理由与 P4-09 为自递归工作流定义记下的一致:操作者读到"这几个版本构成一个环"就知道该改哪几条声明,而读到"步数太多"则分不清那是循环还是一段很长的历史。
