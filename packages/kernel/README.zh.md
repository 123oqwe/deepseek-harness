---
description: "kernel 包组：dsh 其余一切都围绕其组装的最小、不可替换 Trust Kernel 类型表面，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/kernel

[English](README.md) | 中文

## 概述

kernel 组承载 Epic P0-02 的最小、不可替换 Trust Kernel 边界：kernel 可能发放给运行时的窄、不可伪造能力表面——一个 root identity、一个 signature roots、一个 policy enforcement entrypoint、一个 audit append entrypoint、一个 secret broker handle，以及一个 sandbox attestation verifier——不多不少。dsh 中其余一切——模型、工具、存储 provider、workflow、memory provider、UI——仍是普通的、可替换的 Cordis 插件；完整边界与六项能力为何都不是 Cordis Service，见 `docs/architecture/trust-kernel-boundary.md`。本组目前只交付一个包的 Contract 阶段切片：`TrustKernel` 类型表面，尚无构造出的值，也没有 `ctx.provide` 接线。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`trust-kernel`](trust-kernel/README.zh.md) | 最小、不可替换 Trust Kernel 能力表面：root identity、signature roots、policy enforcement、audit append、secret broker handle、sandbox attestation verifier | 尚无（Contract 阶段；无 `ctx.provide` 接线） |

-----

<a id="related-documentation"></a>
## 相关文档

- [Trust Kernel 边界](../../docs/architecture/trust-kernel-boundary.zh.md)——kernel 拥有什么、为何都不是 Cordis Service，以及周围插件/非插件的划分。
- [Trust Kernel 规范](../../spec/trust-kernel.md)——规范性能力表面与 Epic P0-02 的 must/acceptance 条款。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
