---
description: "assurance 包组:发布过程围绕其组装的发布证据与不可伪造完成门类型表面,供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/assurance

[English](README.md) | 中文

## 概述

assurance 组承载 Epic P0-07 的 Release Evidence Package:发布过程用来逐个 gate 证明真实发生了什么(命令、时间戳、退出码、环境、日志/工件 digest、测试数、跳过原因——must[0])的类型表面,以及把这些证据绑定到 baseline fingerprint、Git diff 与构建产物 digest,组成一个 `accepted` 字段在任何必需 gate 被跳过或缺失时都无法通过类型检查为 `true` 的聚合 package(must[1]/must[2])。本组目前只交付一个包的 Contract 阶段切片:`EvidencePackage`/`GateEvidence` 类型表面,尚无 `collect-evidence.mjs`/`verify-evidence.mjs` 的产出者或校验器——那是后续 P 阶段切片的交付物。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`evidence-format`](evidence-format/README.zh.md) | Release Evidence Package 的 Contract 阶段类型表面:逐 gate 证据记录、绑定 baseline fingerprint/Git diff/构建产物 digest 的聚合 package,以及 `accepted=true` 的结构性不变式 | 无(任何阶段都没有 Cordis 插件表面) |

-----

<a id="related-documentation"></a>
## 相关文档

- [`docs/testing.md`](../../docs/testing.zh.md#boot-time-baseline-preflight)——既有的 baseline fingerprint 先例(`@deepseek-ai/dsh-baseline-preflight`,P0-01),本组的 `BaselineFingerprintBinding` 以 digest 方式绑定它。
- [`tests/release/evidence-package.spec.ts`](../../tests/release/evidence-package.spec.ts)——本组唯一包的 Contract 阶段类型表面证明。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
