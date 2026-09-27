# Agent Note：manifest 比对从 Loader 导入的地方找包

Status: implemented

[English](2026-09-27-the-manifest-comparison-finds-a-package-where-the-loader-imported-it.md) | 中文

## 问题

P1-01 acceptance[0] 要隔离注册与声明不符的插件。启动后的比对从 `@deepseek-ai/dsh-plugin-inventory` 自己的位置找包，而 Loader 从配置树 base URL 往上的各个 `node_modules` 目录导入裸名，在 `dsh` 下就是 profile 目录。`dsh plugin add` 把包装在这个目录里，所以它装的包一个都找不到，全被跳过。补丁里指向文件的一行会变成 `file:` URL，它不对应任何包名，也被跳过。B-519 第一笔之后，比对实际只覆盖四个第一方入口包（A-558b，lane B 的路径表）。

## 决策

- `resolveEntryPackageDir` 接收条目所在配置树的 base URL，从那里找裸名，与 Loader 的解析一致。没有 base URL 时仍从自己的位置找，裸测试树就是这样。
- `file:` 条目解析到该文件往上最近的、有 `package.json` 的目录，所以 bundle 层里的文件按那一层的 manifest 比对。
- `buildPluginPermissionStates` 传入每个条目的 `entry.parent.tree.ctx.baseUrl`；profile 启动不动。

## 已考虑的替代方案

- **profile 目录与安装目录都找。** Loader 从 profile 导入了一份，却在安装目录找到另一份时，会拿错的 manifest 来比。

## 后果

- `dsh plugin add` 装的包、补丁行指向的文件，都与第一方包一样被比对，不符就隔离。
- 验证：A-558b（`tests/first100/fixtures/P1-01.quarantine.composition.spec.ts`）的入口声明不符层与子路径层。
