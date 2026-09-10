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
- [must[2]:由操作者在 CLI 显式确认,且导出在先](#must2-an-operator-confirms-at-the-cli-and-the-export-comes-first)
- [Model Experience](#model-experience)
- [已知局限与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="what-this-package-deliberately-does-not-do"></a>
## 本包刻意不做的事

**它不执行升级。** Epic P1-10 的 must[1] 点了六个阶段——冻结、快照、隔离区迁移、校验、原子切换、健康检查——那是一组作用在真实副作用上的次序。一个能执行其中任何一步的模块,就会成为升级发生的第二个地方;事务属于 Provider 阶段。

**它不判定前置条件。** 迁移的前置条件被原样报回调用方,因为本包无从知道磁盘是否可写、外部系统是否可达。一个被默默当成已满足的前置条件,会让升级建立在没有任何人作出的假设之上。

**它不碰工作区文件。** `PluginDataSnapshot` 覆盖的是插件自己的持久数据、配置与 schema。工作区路径是**被拒绝**的输入,而不是"暂不支持":P3-11 拥有工作区检查点,而 manifest 的备份策略正是两者最容易混淆的地方。

<a id="must2-an-operator-confirms-at-the-cli-and-the-export-comes-first"></a>
## must[2]:由操作者在 CLI 显式确认,且导出在先

不可逆升级只在操作者显式确认后才继续——TTY 交互确认,或无 TTY 时 `--confirm-irreversible <路径 digest>`。非交互且没有该标志,则**拒绝且磁盘零改动**:一次靠沉默继续的升级,会让审批在它唯一存在意义的场合沦为形式。

确认点的是**有序步骤的 digest**,因此它准入的是某一次具体转换,而不是"这条命令临时决定要跑的东西"。若 manifest 在操作者读过之后、升级运行之前被改动,digest 就会不同,确认随之**失配**,而不是悄悄覆盖新路径。

**导出必须在确认被接受之前产出。** 操作者确认一次不可逆转换,确认的是自己仍能把数据取出来;先接受确认,会让导出在不可回头之后才失败。

这里**刻意不使用** `@deepseek-ai/dsh-user-approval`。那条缝的请求携带 `toolName`,并且在没有开启的 turn 之外会抛,因为它的 `approval/asked` + `approval/decided` 必须被 turn 包住,否则重启读到的是崩溃残尾。CLI 升级不在 turn 里,借用它是**误用**而不是捷径。而由**会话内部**触发的迁移(自修改流)确实属于那条缝,归 P1-11。

把确认连同操作者身份、时间与导出路径记入事务记录,是 Provider 阶段的事。

## 开发备注

环是被**结构性**拒绝并被点名的,而不是靠深度上限撞出来的。理由与 P4-09 为自递归工作流定义记下的一致:操作者读到"这几个版本构成一个环"就知道该改哪几条声明,而读到"步数太多"则分不清那是循环还是一段很长的历史。

## Model Experience

无,因为本包决定并编排的插件升级运行在 `dsh plugin` 中、发生在任何 agent 启动之前,且不注册工具、提示词文本或会话事件。

#### KV Cache effect

这里没有任何东西进入模型请求;升级发生在会话之间,而不是会话之内。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- **目前没有任何东西消费这些决策。** 这是 Contract 阶段:词汇与判断已存在,而运行它们的事务属于 Provider 阶段。读者不得把这些测试当作"任何升级是事务性的"的证据。
- **must[2] 的确认在此判定,提示则在 Provider 阶段。** 本包判定一次确认是否准入某条路径;TTY 提示、`--confirm-irreversible` 标志、导出与 append-only 事务记录都属于 Provider 阶段。由会话内部触发的迁移改走 `@deepseek-ai/dsh-user-approval`,归 P1-11。
- **`refuseOutsidePluginStorage` 比较的是已解析的路径。** 它自己不做解析,因为解析要读文件系统。调用方若传入未解析的 `../` 路径,比较的就是"看起来不是那个意思"的字符串;先解析再调用是调用方的义务,也是 Provider 阶段要履行的。

<a id="dev-note"></a>
