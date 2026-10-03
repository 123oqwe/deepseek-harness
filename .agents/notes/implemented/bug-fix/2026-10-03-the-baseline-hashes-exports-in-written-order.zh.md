# Agent Note：基线按书写顺序给 exports 取哈希

Status: implemented

[English](2026-10-03-the-baseline-hashes-exports-in-written-order.md) | 中文

## 问题

`baseline-fingerprint.mjs` 给每个包清单字段取哈希之前，先把对象的键逐层排序，所以内容相同、键序不同的值哈希相同。`exports` 与 `imports` 的键序本身就有含义：Node 自上而下解析它们的条件，`types` 在 `default` 之前与 `default` 在 `types` 之前解析出的结果不同。于是交换两个条件不算漂移，`verify` 放过了一个改变包解析结果的改动（P0-01 盲审 1-2；A-594 在一个夹具 checkout 上观测到）。

## 决定

- `exports` 与 `imports` 按书写的键序取 JSON 的哈希；其余字段照旧用排好序的规范形式，所以与顺序无关的字段改了排版仍不算漂移。
- 这两个字段的漂移，与别的字段一样，报为该清单的 `exports` 或 `imports`。
- 基线格式升为 4。格式 3 的基线里，`exports` 与 `imports` 存的是排序后形式的哈希，逐字段比对会在每个条件不按字母序排列的包上报出虚假的漂移；`verify` 改为报出格式不同，已提交的基线要重采。

## 考虑过的替代方案

- **除条件对象之内以外处处排序。** 哪些嵌套对象是条件表，由 Node 的解析规则决定，而不是由 JSON 的形状决定；把这两个字段整体按书写顺序取哈希，就用不着这样的规则。

## 后果

- 调换一个包 `exports` 或 `imports` 里的条件顺序，现在是一条点名该字段的基线漂移。
- 已提交的 `.dsh/baseline.json` 在从一次带着本改动的全量重采之前，仍是格式 3。
