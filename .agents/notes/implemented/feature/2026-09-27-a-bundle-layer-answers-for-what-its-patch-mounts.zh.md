# Agent Note：组合包层为它的 patch 挂进来的东西负责

Status: implemented

[English](2026-09-27-a-bundle-layer-answers-for-what-its-patch-mounts.md) | 中文

## 问题

P1-01 acceptance[0] 要隔离注册与声明不符的插件。启动后的比对拿每个 Loader 条目与它自己包的 manifest 比。组合包层的 patch 挂进别的包时，这一层的声明不参与比对：挂进来的包若自己不带 manifest，就从来不被判；像 `dsh-base` 这样自己没有 Loader 条目的层，根本不比。一层可以声明一个工具，却挂进一个注册另一个工具的插件（A-558b 的第 5 层）。

## 决策

- 每一个注册恰好对一份 manifest 负责。准入的组合包层插入的条目（含插入的组里的条目），随这一层一起判，除非它自己的包带有自己的 Manifest v2。这一层自己的入口，与它挂进来的、不带 manifest（缺失或 legacy）的包，合在一起与这一层的 manifest 比对；自带 Manifest v2 的包仍按它自己的那份比对。
- `composeProfile` 记下每个准入层的包目录与它的 patch 插入的条目 id；`buildPluginPermissionStates` 以 `bundleLayers` 接收，每个状态的 `judgedBy` 写明是哪个包的 manifest 判的它。
- `applyPostMountPluginEnforcement` 处置随被隔离的 manifest 判的每个条目，以及被隔离的层插入、没有别的 manifest 判的条目；stderr 那一行写判它的包，对层来说就是这一层。

## 已考虑的替代方案

- **层插入的全部条目都与层的 manifest 比。** 自带 manifest 的包就要在两份 manifest 里各声明一遍它的注册，日后会对不上。
- **只比自己没有 Loader 条目的层。** 入口层照样可以挂进一个没声明的插件而不被判。

## 后果

- 出厂各层的 manifest 只声明自己入口的注册（四个入口包）或工具（`dsh-base`、`dsh-sdk-minimal`），而每一层都挂进了不带 manifest 的第一方包。所以强制一开，在 manifest 补上它挂进来的东西之前，出厂各层都会被隔离。强制默认仍关；按一次真实启动普查补全出厂 manifest，归打开强制的那一笔，与用户第 27 题 (a) 一起做。
- 层自己的入口不再单独比，只随这一层一起比。
- 验证：A-558b（`tests/first100/fixtures/P1-01.quarantine.composition.spec.ts`）的非入口层。
- 本笔部分取代 [出厂组合包声明 Manifest v2，manifest 按包比对](2026-09-27-shipped-bundles-declare-manifest-v2-compared-per-package.zh.md)：按包比对层的条目，以及启动后比对覆盖不到 `dsh-base`、`dsh-sdk-minimal` 的说法。
