# Agent Note：profile 启动按锁核对它自己的插件

Status: implemented

[English](2026-10-04-a-profile-boot-checks-its-own-plugins-against-the-lock.md) | 中文

## 问题

Epic P1-03 must[2] 要求生产启动只加载锁批准、且 digest 匹配的插件。做这个判断的锁门（`gateProfileAgainstLock` 之上的 `gateProductionBoot`）已经写好、测过，但没有任何启动调用它：验收锁表里 P1-03 那一行记的就是这件事，BLOCKED-094 则把「没有锁的 profile 启动时怎么办」留成了悬案。

## 决定

- **组合完成之后，启动调用锁门。** `composeProfile` 在组合出全部行之后、`boot()` 求值任何插件模块之前运行它，所以被拒的启动什么都没有运行。
- **锁门判的是 profile 从自己的 `node_modules` 解析出来的东西**（C17 方案 2′，delegate 对锁门范围的裁定）：声明的依赖、准入后的 bundle 层，以及组合后每一行指名的模块，group 里面的也算。从更上层解析到的名字属于安装：共享的 `$DSH_HOME/profiles/node_modules` 只放启动为安装的依赖闭包写的链接与模块代理，所以安装自带的包永远不进锁。
- **只有在有东西可判时才运行：** 上述集合非空，或者 profile 有 `plugins.lock.json`。只由出厂 bundle 组成的 profile 照旧启动。
- **没有锁的 profile 被拒。** `@deepseek-ai/dsh-base` 声明 `dsh.pluginLock.unlockedProfilePolicy: "refuse"`（delegate 对 BLOCKED-094 的裁定：must[2] 只认锁批准的插件，没进锁的插件不是）。这项声明只在 profile 没有锁时读取，因为有锁的 profile 无论策略如何都按锁判。`dsh plugin` 会提交锁，所以 profile 总能得到一份锁。
- **相对路径行不归锁门管。** 它指的是本地文件，不是装进来的包，锁没有东西可钉；由 P1-01 的补丁行准入来判。

## 考虑过的替代方案

- **只判声明的依赖。** 一个放进 profile 的 `node_modules`、写进 `dsh.profile.bundles` 却没写进 `dependencies` 的 bundle，会不经核对就被加载。
- **声明 `warn-and-proceed`。** 启动会加载没进锁的插件，这正是 must[2] 禁止的。
- **去掉不匹配的插件，其余照常启动。** `admitBoot` 有意对整个 profile 失败即关闭：少了一个插件的 profile，已经不是锁定的那个 profile。

## 后果

- profile 自己目录里有锁未批准的插件，或者根本没有锁，就不再能启动；`dsh plugin add`、`update`、`remove` 会让锁保持最新。
- 在 profile 目录里铺包的测试与夹具，需要一份照 `dsh plugin` 的方式写出的锁，连同 profile 的 `pnpm-lock.yaml` 记下的 integrity。
