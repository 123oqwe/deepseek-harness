---
description: "schema 分组导览：为每个持久化或线协议叶子对象给出唯一身份与版本，以及裁定"本构建能否读这条记录"的兼容规则，供使用者与维护者在分组内导航。"
kind: "package-group"
---

# packages/schema

[English](README.md) | 中文

## 概述

schema 分组回答一个问题:**本构建能否读那条记录?** 它给每个持久化或线协议叶子对象一个 `schemaId` 与一个主/次版本,并持有裁定这些版本的兼容规则 —— 次版本不同可读、主版本不同不可读,而这个裁定是**一个函数**,不是每个读方各自重实现一遍的约定。一个包,没有插件,没有 ctx 键,没有任何模型可见面:本组是一套词汇加一个决策,而将来会咨询它的那些读方住在别处。

包自己的 README 位于下一层目录,目前只有英文版,这也是下面那个名字没有做成链接的原因:否则本页就会声称存在一个并不存在的中文对应页。

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
| `schema-registry` | `schemaId` 身份、主/次版本、兼容规则、迁移注册,以及 `negotiateSchema` | —（一个库） |

-----

<a id="what-is-not-arrived-yet"></a>
## 尚未抵达的部分

取自包自己的 Known Limitations。本组离它的读方比多数分组都远,这些条目如实说明这一点,而不是读起来像"几乎完工"。

- **`negotiateSchema` 没有接进任何读取路径。** 它是真实且有测试的;至今没有会话回放、SDK initialize 或插件加载咨询过它。
- **不存在任何真实的第二版 schema。** 每个已引导的 schema 都停在自己的第一版、配一个恒等迁移,所以兼容规则在生产中从未需要拒绝任何东西。
- **SDK 协议的 `schemaId` 列表是手工镜像的。** `PROTOCOL_WIRE_SCHEMA_IDS` 靠人手同步而不是派生,而这正是本仓在别处视为一类缺陷的形状。

-----

<a id="related-documentation"></a>
## 相关文档

- [控制协议子系统](../../docs/subsystems/control-protocol.zh.md) —— 逐消息的 schema 协商,经由本注册表解析:回答"本构建能否读这条消息",作用域限于一种消息形状,对对端整体不作任何断言。
- [Settings 子系统](../../docs/subsystems/settings.zh.md) —— 这套身份的一个在用消费者:每个命名空间以 `schemaId` `settings:${ns}` 携带自己的注册表版本。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

本开发备注是面向维护者的工作上下文:开放问题与尚未定下的方向。它明确不具权威性 —— 已发布的行为与边界位于上面各节以及包自己的 README 中。

开放问题是 **一条从不拒绝的规则还算不算规则**。所有 schema 都在第一版,所以 `negotiateSchema` 在生产中从未对任何读方说过"不";它第一次说"不"的那一刻,也是下游第一次必须为那个答案准备方案的时刻。把它接进读取路径、和引入第二个版本,是同一件工作的两端 —— 只做其中一端,另一端就仍然未被测试。

第二个问题是 **`PROTOCOL_WIRE_SCHEMA_IDS` 怎样才能不再靠手工镜像**。本仓在别处的做法是从声明本身派生这类列表并用门校验;这里它是一份需要有人记得去更新的清单,而那正是 `BLOCKED-192` 所概括的失效模式。

</details>
