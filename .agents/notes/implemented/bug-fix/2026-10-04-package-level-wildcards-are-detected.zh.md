# Agent Note：包级通配也被检测

Status: implemented

[English](2026-10-04-package-level-wildcards-are-detected.md) | 中文

## 问题

`@deepseek-ai/dsh-plugin-manifest` 的通配检测（`detectWildcardPermissions` 与 `partitionWildcardFindings`）只读工具、MCP 服务端和远程 Skill provider 的目的地，从不检查 manifest 包级的 `filesystem`、`network`、`process` 字段。于是一个声明 `process.commandPatterns: ["*"]` 的包在 `enforce` 下无需授予、也不留记录就过了准入。不注册工具却会起命令的包（例如运行用户 `hooks.json` 里命令的 hooks 桥接），只能在包级声明这种范围（4i1b 步骤 3）。

## 决定

- 检测覆盖包级 `filesystem.readPaths`、`filesystem.writePaths`、`network.hostPatterns`、`process.commandPatterns` 的每个模式，并按这些路径报告。
- `WildcardGrant` 可以不写工具；这样的授予只覆盖同一目的地类别、同一模式的包级发现。写了工具的授予只覆盖该工具的发现，MCP 服务端或远程 Skill provider 的发现一律不授予。
- 准入决定记录里，包级授予不写 `tool`。

## 考虑过的替代方案

- **继续不查包级字段。** 那样任何包都能在包级要任意范围并被悄悄放行，而默认 `enforce` 正是要拦这个。

## 后果

- 包级通配若没有安装授予，会在挂载前被拒或挂载后被隔离；授予照工具授予一样记录。
