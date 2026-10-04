---
description: "在解析器或模型看到之前扫描解码后的附件载荷中的恶意内容，供把附件安全接入组合的维护者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-security

[English](README.md) | 中文

## 概述

解码后附件载荷的恶意内容扫描器（Epic P3-12 must[1]）。它实现 `AttachmentScanner` 能力缝（`ctx.attachmentScanner`，由 `@deepseek-ai/dsh-attachment` 声明），在任何解析器或模型看到载荷之前对其分类，拒绝：声明与嗅探的媒体类型不符、超比解压（zip 炸弹）、polyglot、像素炸弹、归档嵌套过深、带宏文档、以及原生可执行文件。

它只读取开头的魔数与 ZIP 中央目录元数据——从不解压载荷来检查，因此扫描器自身不是炸弹的膨胀面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

在组合中挂载它，供附件存储调用：

```yaml
- id: attachment-security
  name: '@deepseek-ai/dsh-attachment-security'
  config:
    maxDecompressionRatio: 100
    maxNestingDepth: 1
    maxPixels: 64000000
```

`ctx.attachmentScanner.scan({ bytes, declaredMediaType })` 返回 `{ admit: true }` 或 `{ admit: false, refusal: { kind, detail } }`，其中 `kind` 为 `mime-mismatch`、`decompression-ratio`、`polyglot`、`pixel-bomb`、`nesting-depth`、`macro`、`executable` 之一。

### 配置

每个阈值都是部署解析的字段，检测器中没有任何硬编码。

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `maxDecompressionRatio` | `100` | 归档可声明的最大“总未压缩与压缩之比”。 |
| `maxNestingDepth` | `1` | 允许的最深归档套归档层数；`0` 禁止任何嵌套归档。 |
| `maxPixels` | `64000000` | 栅格图像允许的最大固有宽乘高。 |

<a id="understand-the-implementation"></a>
## 理解实现

### 源码地图

| 文件 | 职责 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | `AttachmentSecurityScanner` 服务、其 `Config` 与 `DEFAULT_*` 解析默认值。 |
| [`src/scanner.ts`](src/scanner.ts) | 魔数嗅探器与 `scanPayload` 背后的七个检测器。 |

### 设计决策

- **决定属于存储的 save 路径，而非本 provider。** 本包返回裁决；后续分片在附件存储的 save 操作里调用它，使得直连存储的调用方无法带着未扫描的载荷抵达解析器（仅在准入入口检查是更窄、可被绕过的检查）。
- **不解压。** 归档检查通过 `fflate` 的提取过滤器读取 ZIP 中央目录里声明的大小与条目名，从不膨胀任一成员。比例检查在读取任何嵌套归档之前先清本层。

<a id="further-exploration"></a>
## 延伸阅读

- [附件子系统参考](../../../docs/subsystems/attachment.zh.md)——本扫描器守护的 `ctx.attachments` 服务契约。
- [能力缝](../../../docs/capability-seams.zh.md)——本系列遵循的 Service Definition / Provider / Consumer 划分。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **流式逐字文件不做内容扫描。** 扫描在 `AttachmentStore.saveImages` 与 `saveFile` 中强制，故任何 provider 覆盖都无法带着未扫描的载荷抵达提交；`saveFileStream` 无法缓冲整个载荷来扫描，故流式文件绕过扫描（未来分片对其增量扫描）。
- **WebP 在此没有像素炸弹检查。** 嗅探器识别 WebP，但不解析其尺寸；WebP 像素炸弹尚未被拒绝。
- **嵌套仅通过对嵌套归档成员的有界解压来测量。** 深度通过递归进入名字为归档的成员来测量，且在每层先过比例检查；以非归档名字伪装的嵌套归档不会被递归进入。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：尚未决定的探索方向与开放问题。它明确不具权威性——已交付的行为与限制以上文和包代码为准。

WebP 像素炸弹检测、以非归档名字伪装的递归嵌套检测、以及对流式文件的增量扫描，是开放工作；见上文「已知限制与后续工作」。

</details>
