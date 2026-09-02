---
description: "plugin 包组:Plugin Manifest v2 能力/权限声明类型表面,供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/plugin

[English](README.md) | 中文

## 概述

plugin 组承载 Epic P1-01 的 Plugin Manifest v2:插件包携带的静态 `dsh.manifestVersion=2` 声明,让安装器、Policy 引擎或管理员在插件执行前就知道它能访问什么、暴露什么、修改什么。本组目前只交付一个包的 Contract 阶段切片:`PluginManifestV2` 类型表面与纯 schema/通配权限校验逻辑,以及对既有 `dsh.bundle` 格式的兼容读取(参见 [`docs/plugins/manifest-v2.md`](../../docs/plugins/manifest-v2.zh.md))。尚未接入 `dsh plugin`/profile 启动的真实读取器——那是后续 P/U 阶段切片的交付物。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`plugin-manifest`](plugin-manifest/README.zh.md) | Plugin Manifest v2 的 Contract 阶段类型表面与纯校验逻辑:`dsh.manifestVersion=2` 能力声明、must[1] 的 Tool/MCP 副作用字段、通配权限检测,以及旧版 `dsh.bundle` 兼容读取 | 无(任何阶段都没有 Cordis 插件表面) |

-----

<a id="related-documentation"></a>
## 相关文档

- [`docs/plugins/manifest-v2.md`](../../docs/plugins/manifest-v2.zh.md)——manifest 格式的用户侧文档。
- [`docs/architecture.md#profiles-and-bundles`](../../docs/architecture.zh.md#profiles-and-bundles)——本组 manifest 所附加的既有 `dsh.bundle`/`dsh.profile` `package.json` `dsh` 字段词汇。
- [`spec/capability-manifest.schema.json`](../../spec/capability-manifest.schema.json)——与本组 TypeScript 类型表面对应的 JSON Schema(draft 2020-12)。

-----

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
