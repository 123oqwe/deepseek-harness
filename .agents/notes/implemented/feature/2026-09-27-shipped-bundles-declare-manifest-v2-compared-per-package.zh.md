# Agent Note: 出厂 bundle 声明 Manifest v2，manifest 按包比对

Status: implemented

[English](2026-09-27-shipped-bundles-declare-manifest-v2-compared-per-package.md) | 中文

## 问题

P1-01 的验收锁（BLOCKED-273）要求出厂 profile 在开着插件 manifest 强制时启动，并留下自己的各层。出厂的每个 bundle 包都只有 `dsh.bundle`，所以生产准入把它们全判为 `legacy-untrusted` 而拒绝。

一旦声明 manifest，启动后的比对暴露出两处缺陷。它把每个 Loader 条目单独拿去比所属包的 manifest，于是有两个条目的包在两个条目上都与 manifest 不符：`dsh-headless` 与 `dsh-web-app` 各有一个 `/startup` 条目和一个主条目。`@deepseek-ai/dsh-headless/startup` 这样的子路径条目根本解析不到包，被跳过，它的注册逃过了比对；第三方包也能照这个样子藏起注册。

headless 运行器还把它的两个监听注册在异步启动的那次运行里，其中一个只在 `stream-json` 时注册，所以启动后的快照看到什么，取决于时序和输出格式。静态 manifest 无法在两个方向上都与这样的集合相符。

## 决策

- 六个出厂 bundle 包在 `bundle.patch` 旁声明静态的 Manifest v2。四个条目型 bundle 声明它们自己的条目注册的东西：启动服务，`dsh-headless` 另有它的两个事件。`dsh-base` 与 `dsh-sdk-minimal` 不是 Loader 条目，声明它们的 patch 组合进来的工具，每个工具写如实的最大可达范围。这一笔不改强制的默认值。
- manifest 描述的是包。`buildPluginPermissionStates` 把子路径条目解析到包根，并拿同一包所有条目注册的并集，去比这个包的每个条目。这些条目共用一个判定，所以被隔离的包失去它的每个条目。每个状态的 `observed` 仍是该条目自己的。
- headless 运行器在 `apply` 里、在每种输出格式下，只注册一次 `session/event` 与 `agent/assistant-stream`。`run` 在原来注册它们的地方把它们指向自己的 Agent，在原来释放它们的地方清掉。
- `spec/capability-manifest.schema.json` 接受与 v2 字段并存的 `bundle` 键，与 TypeScript 校验器原本的做法一致，所以两个校验器对 bundle 包给出同一个结论。

## 已考虑的替代方案

- **只在一个方向上比对**，拒绝未声明的注册，放过声明了却没注册的名字。这收窄了 acceptance[0]「声明与实际注册不一致」，所以不取。
- **保留逐条目比对，把每个多条目 bundle 拆成每个条目一个包。** 这是为了迁就一个对包的描述本身就错了的比对，去改包的结构。
- **声明比工具实际可达范围更窄的目的地**，例如给 `web_fetch` 写 `https://*`。这是靠少报可达范围来通过通配检查。

## 后果

- `dsh-base` 在没有更窄的如实写法时声明通配目的地：读文件（沙箱只围住修改），写文件（`danger-full-access` 会去掉围栏），`web_fetch` 与 `run_code`。所以生产准入仍然拒绝它。出厂的层带着这样的声明能不能被准入，是交给用户的第 27 题；在答复之前，强制默认仍然关闭。
- `dsh-base` 与 `dsh-sdk-minimal` 不是 Loader 条目，所以没有启动后的比对覆盖它们。对这类层的比对范围，先量清再定。
- 子路径条目现在出现在 Plugin Inventory 里，并带着所属包的 bundle 来源。
- 本 note 部分取代[Plugin Manifest v2 在 profile 启动时的真实强制](2026-09-02-plugin-manifest-real-enforcement-at-profile-boot.zh.md)：取代它的逐条目比对，以及它「没有出厂 bundle 声明 Manifest v2」的说法。

本 note 被[插件 manifest 强制执行是一个默认 enforce 的 feature gate](2026-09-27-plugin-manifest-enforcement-is-a-feature-gate.zh.md)部分取代：强制执行不再默认关闭。
