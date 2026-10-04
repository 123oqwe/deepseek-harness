# Agent Note：补丁挂入的包也拿到安装授予

Status: implemented

[English](2026-10-04-patch-mounted-packages-receive-installation-grants.md) | 中文

## 问题

在 `plugin-manifest-enforcement: enforce` 下，用户补丁层挂进来的行与 bundle 层过同一套准入（第 28 题 (a)），但只有 bundle 层能拿到安装的通配授予（第 27 题 (a)）。用户经补丁行挂载的一些已发布包，如实声明范围就只能写通配：`cordis_run` 运行会话定义的插件代码，`lsp` 启动运营方配置的语言服务端，`subagent_acp` 启动配置的 ACP agent，hooks 桥接运行用户 hooks 文件里的命令。照实写的 manifest 会在挂载前被拒或挂载后被隔离（4i1b 步骤 3，Q1）。

## 决定

- `INSTALL_WILDCARD_GRANTS` 在 dsh-base 与 dsh-sdk-minimal 的授予旁列出这些授予，按工具授予，hooks 桥接则授予其包级 `process` 字段。
- `installationPackageWildcardGrants(name, dir, installAnchor)` 只在目录的真实路径就是本安装自己那份副本时给出该包的授予；`installationWildcardGrants` 把它用于 bundle 层。
- 挂载前，补丁行若只因其包被授予的通配被拒，就放行，并以包名在 `admission-decisions.jsonl` 里记一条 `granted`。挂载后，`buildPluginPermissionStates` 接受 `packageWildcardGrants`，按自身包 manifest 判定的条目只就安装没有授予的通配作决定。

## 考虑过的替代方案

- **只按包名授予。** 包名可以照抄；安装之外的同名包会拿到授予。
- **要求这些包显式 `shadow`。** 出厂 hooks 桥接、语言服务工具和动态 Cordis 工具的每个用户都得关掉强制。

## 后果

- 这些包在本安装自己的副本，在 `enforce` 下凭授予被放行并保持活动；安装不带的副本因同样的通配被拒或隔离。
- 每条授予都在授予表、inventory 的 `grantedWildcards` 里看得见；补丁行的授予还记在准入决定日志里。
