---
description: "Epic P1-04 的隔离安装安全核心，供接入「在恶意包抵达 profile 前拒绝它」的插件安装的维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-plugin-installer

[English](README.md) | 中文

## 概述

Epic P1-04 隔离插件安装的安全核心。调用方把未信任的插件 tarball 暂存到 quarantine 目录并调用 `extractQuarantined`：它**拒绝**（而非悄悄清洗）路径穿越、绝对路径、symlink 或 hardlink 条目、条目数超限、以及声明总大小超过炸弹上限的归档；否则在**不运行任何生命周期脚本**的情况下解包。profile 及其 lock 从不被触碰，故被拒或失败的安装让它们保持逐字节不变。

签名、来源证明与 SBOM 验证沿用既有 P1-02 路径（`@deepseek-ai/dsh-plugin-provenance`）；本包补上解包安全这一半。把已验证的包 promote 进 profile 是后续分片。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

```ts
import { extractQuarantined, DEFAULT_MAX_TOTAL_BYTES, DEFAULT_MAX_ENTRIES } from '@deepseek-ai/dsh-plugin-installer'

const dir = await extractQuarantined(quarantinedTarballPath, {
  maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
  maxEntries: DEFAULT_MAX_ENTRIES,
})
```

`extractQuarantined` 解析为包被解包到的目录，或在遇到第一个不安全条目时抛 `PluginInstallError`（`code: 'MALICIOUS_PACKAGE'`，`threat` 指明类别）。`inspectTarball` 跑同样的检查但不解包。

### 不跑任何生命周期脚本

安全核心只解包文件；它从不调用 npm、从不运行包的 `preinstall`/`postinstall`。基于脚本去读 `$HOME`、访问网络或写 profile 的企图根本不会发生，因为没有脚本运行。

## 理解实现

<a id="understand-the-implementation"></a>

### 源码地图

| 文件 | 职责 |
| --- | --- |
| [`src/extract.ts`](src/extract.ts) | `inspectTarball`（列举归档但不解包，记录第一个不安全条目，遍历后再抛；全程不写盘，故被拒的炸弹永不膨胀到磁盘）与 `extractQuarantined`。 |
| [`src/types.ts`](src/types.ts) | `UnpackPolicy`、`UnpackThreatKind` 闭合 union、`PluginInstallError`。 |
| [`src/index.ts`](src/index.ts) | 公共导出面与 `DEFAULT_*` 策略上限。 |

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **promote 与 lock 是后续分片。** 本包在 quarantine 中暂存并验证；把它接进 `dsh plugin add`、带 atomic promote 与插件 lock 对账是后续分片（耦合 `plugins.lock`）。
- **dsh 只装预构建产物。** 在无网络、无凭证、临时文件系统的 build sandbox 中从源码构建插件是另立的未来能力；本核心既不构建也不沙箱化构建。

## 开发备注

<a id="dev-note"></a>

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：尚未决定的探索方向与开放问题。它明确不具权威性——已交付的行为与限制以上文和包代码为准。

拒绝依赖 node-tar 在条目头处交出不安全条目；遍历记录第一个违规并在遍历后重抛，故检测不依赖归档流如何传播遍历中的抛错。

</details>
