# Agent Note：安装给自带的层授予通配

Status: implemented

[English](2026-10-03-the-installation-grants-its-shipped-layers-wildcards.md) | 中文

## 问题

`plugin-manifest-enforcement: enforce` 下，Manifest v2 申请通配目的地的组合包层，挂载前被拒，挂载后被隔离。出厂的 `@deepseek-ai/dsh-base` 声明了八个这样的工具（`read`、`read_image`、`glob`、`grep`、`write`、`edit` 能到任何路径；`web_fetch` 能到任何主机；`run_code` 能跑任何命令），`@deepseek-ai/dsh-sdk-minimal` 声明了 `run_code`，所以一开 enforce 就会拒掉产品自己。挂载后的隔离还会因为某一层声明了却从未注册的能力而触发，CENSUS-1 在每个出厂层上都发现了这种情况。第 27 题 (a) 给自带的层显式授予通配；第 32 题 (a) 只隔离插件注册了却没声明的东西。

## 决定

- **授予表放在安装里。** `@deepseek-ai/dsh-app-boot` 的 `INSTALL_WILDCARD_GRANTS` 与 `PROFILE_TEMPLATES` 并列，按层、按工具列出每条授予的目的地种类、模式与用途：dsh-base 八条，dsh-sdk-minimal 一条。它不拷进 profile，所以旧的或自定义的 profile 只要叠了同一个层，就得到同样的授予。`installationWildcardGrants` 只在层的包目录正是从安装锚解析出的那个目录时才给出授予；别处的同名包一条也得不到。
- **一次拆分，两处判定。** `@deepseek-ai/dsh-plugin-manifest` 的 `partitionWildcardFindings` 把一份 manifest 的通配发现分成有授予写明的（工具、种类、模式都相同）和其余的；MCP server 或远程 Skill provider 的通配从不被授予。`partitionProfileLayersByAdmission` 让只因已授予的通配被拒的层准入，并列在 `granted` 里；`buildPluginPermissionStates` 只按未授予的通配判这一层的状态，把已授予的写成 `grantedWildcards`。不传授予时，两者的返回与以前完全一样。
- **声明了却从未注册不触发隔离。** `decidePluginTrust` 只在有 `undeclared-registration` 不一致或通配发现时隔离；`declared-not-registered` 不一致照样比对、记录、展示。
- **每个决定都有记录。** `enforce` 启动时，每个获授予的层、每个被拒的层、每次隔离，各往 `$DSH_HOME/feature-gates/admission-decisions.jsonl` 追加一行：`recordedAt`、`layer`、`decision`、`grants`（`tool`、`destinationKind`、`pattern`、`source: install-grant-table`、`purpose`），拒绝或隔离时再加 `reason`。

## 考虑过的替代方案

- **把授予写进每个出厂 profile 模板。** 模板只在建 profile 时拷一次，早先建的 profile 收不到后来加的授予，叠了 dsh-base 的自定义 profile 也一条都没有。
- **只按层与目的地种类授予。** 以后给 dsh-base 新加一个通配工具，会在没人写下来的情况下被覆盖；逐个工具授予让每一个新的都要显式改一处。

## 后果

- 开了 enforce，出厂的层凭授予准入并保持 active，记录里写明它们用到的每条授予。
- 这一笔默认仍是 `shadow`；改成 `enforce` 在 CENSUS-2 的全量之后。
- 不涵盖：决定记录只追加，与 shadow 记录一样；用户补丁行级别的拒绝写到 stderr，不进这份记录。
