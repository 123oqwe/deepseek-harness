---
description: "Epic P5-11 的共享结构化事实板:事实是结构化值或工件引用,绝不是自由散文,且每条事实都能追溯回产生它的观测。"
kind: "package-reference"
---

# @deepseek-ai/dsh-blackboard

[English](README.md) | 中文

## 摘要

黑板是多个 agent 放置各自发现、供他人在其上继续构建的地方。`admitFact` 决定什么可以被写入;`traceToObservations` 回答一条事实从何而来。

## 事实要么是结构化的,要么是一个引用

`admitFact` 拒绝自由散文。一块接受句子的板会变成一份被多个 agent 当作数据来读的聊天记录,而第一个去解析它的消费者决定了它的含义。结构化值或工件引用只有一种读法。

这个检查放在运行时,因为写入者可能是模型,而模型的输出到达这个边界时是 JSON 而不是带类型的值。

## 每条事实都追溯到观测

`traceToObservations` 把一条事实回溯到产生它的东西。没有它的板是一组没有来历的断言,读到其中一条的 agent 无法分辨这是一次测量,还是另一个 agent 两跳之前做出的推断。

## Model Experience

None, as this package exports fact admission, observation tracing, and types only and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected.

## 已知限制与延后事项

- **没有保留策略。** 事实会累积;这里没有任何东西会让一块板过期、压缩或设限。
- **信任是一律的。** 任何写入者的事实都按同样的条件被接纳;按写入者区分信任级别需要板目前并不携带的身份。
