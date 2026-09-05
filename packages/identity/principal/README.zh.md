---
description: "Epic P2-01 的统一 Principal/Tenant/Run 身份:一个委派链类型,以及一条拒绝跨租户请求而不是放宽它的运行时租户策略。"
kind: "package-reference"
---

# @deepseek-ai/dsh-principal

[English](README.md) | 中文

## 摘要

一个被每一层共用的身份类型,用来回答*谁在行动、代表谁、在什么委派之下*。`IdentityContext` 携带 principal、它的租户,以及回到根的链;`assertRuntimeTenantPolicy` 强制那条不能交给调用方的规则。

## 跨租户请求被拒绝,绝不被放宽

当请求指名一个该身份并不持有的租户时,`assertRuntimeTenantPolicy` 抛出。它不会回退到身份自己的租户,因为那会把调用方的一个错误,变成一次针对错误客户数据的、悄无声息且成功的不同操作。

## 链就是身份

委派是 `IdentityContext` 的一部分,而不是它旁边的东西。一个经过三次委派抵达的 principal,与同一个 principal 直接行动并不是同一个行动者,而只看到叶子的消费者无法区分二者。

## Model Experience

None, as this package exports identity types and a tenant-policy assertion only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## 已知限制与延后事项

- **链被记录,而不被验证。** 这里没有任何东西检查某次委派是否真的被授予过;那属于 capability-token 缝(`dsh-capability-token`),本包信任它收到的链。
- **租户策略是唯一被强制的规则。** purpose、scope 和 budget 随上下文传递,但由各自的消费者强制,所以单凭身份并不能界定调用方可以做什么。
