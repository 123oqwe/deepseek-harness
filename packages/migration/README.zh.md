---
description: "migration 分组导览：Shadow/Enforce 特性门——它的状态、覆盖链，以及在门可以强制任何东西之前必须一致的影子对照，供使用者与维护者在分组内导航。"
kind: "package-group"
---

# packages/migration

[English](README.md) | 中文

## 概述

migration 分组是"一次行为变更如何被打开":一道门先让新路径以 **Shadow** 方式与旧路径并行并做对照,只有对照一致的门才可以转入 **Enforce**。它是一个解析器加一组决策,**不是服务** —— 解析出的门由 boot 以一个裸 `ctx.provide` 交出,这里没有任何东西注册能力、注入提示词或进入模型请求。不需要挂载;在正在执行迁移的地方调用这些函数即可。

包自己的 README 位于下一层目录,目前只有英文版,这也是下面那个名字没有做成链接的原因:否则本页就会声称存在一个并不存在的中文对应页。

## 目录

- [包](#packages)
- [为什么没有子系统页](#why-no-subsystem-page)
- [尚未抵达的部分](#what-is-not-arrived-yet)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| `feature-gates` | Epic P0-05 的门状态与生命周期元数据、纯覆盖链解析器、影子与旧路径的对照,以及过期检查 | —（一个库;唯一的 Cordis 入口是 `./invariant` 伴生件） |

-----

<a id="why-no-subsystem-page"></a>
## 为什么没有子系统页

本组在 `verify-subsystem-pages` 的 `GROUPS_WITHOUT_SUBSYSTEM_PAGE` 里持有一条豁免,而不是链接某一页,理由是**可核验的:没有服务可写**。解析出的门经由 app boot 中一个裸 `hostCtx.provide('featureGates', …)` 抵达 profile —— 刻意不做成声明式的 Context 服务 —— 所以子系统页本该固定的那套词汇,并不以"被挂载的面"的形式存在。该机制自身的决策改而住在一份 Agent Note 里(见下),与 `plugin`、`kernel` 两组采用的是同一形状。

-----

<a id="what-is-not-arrived-yet"></a>
## 尚未抵达的部分

- **不存在任何真实的门。** app boot 携带的声明列表是空的,因此解析器、对照与过期检查都可达、也都在对"无物"作答。**那正是该机制被刻意建成的状态** —— 先接线、后有第一道真门 —— 而不是事后发现的缺口。
- **没有任何东西强制过期。** `checkFeatureGateExpiry` 会裁决;没有任何定时调用方去问它,所以一道活过了自己发布版本的门,只能靠有人去看才会被发现。

-----

<a id="related-documentation"></a>
## 相关文档

- [Agent Note:先于任何真实门的特性门机制接线](../../.agents/notes/implemented/architecture/2026-09-01-feature-gate-mechanism-wiring-before-any-real-gate.zh.md) —— 构成本组的那些决策:共享解析器而非重复计算,以及不新增 Cordis 服务增强。
- [配置目录](../../docs/config-catalog.zh.md) —— profile boot 所提供的声明形状。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文:开放问题与尚未定下的方向。它明确不具权威性 —— 已发布的行为与边界位于上面各节以及包自己的 README 中。

开放问题是 **一套没有实例的机制能否保持诚实**。这里每个函数都是真实的、都针对构造输入有测试,而没有任何一个裁决过一次真实迁移;于是第一道真门,同时也将是"影子对照是否是正确的对照"的第一次检验。该机制是有意这样建的 —— Agent Note 论证了接线值得先于第一道门而不是后于它 —— 而这个选择的代价就是:它的第一次使用,同时也是它的第一份证据。

</details>
