# Agent Note：入口不再依赖 `import.meta.main`

Status: implemented

[English](2026-09-28-entries-start-without-import-meta-main.md) | 中文

## 问题

有十七个非测试入口只在 `if (import.meta.main)` 时才启动 CLI。根 `engines` 范围 `^22.19.0 || >=24.0.0` 认可 Node v24.0.0，而那个版本上 `import.meta.main` 是 undefined，所以这些入口什么都不做、以 0 退出：workflow 运行 36402168106 对 `baseline-fingerprint.mjs verify` 实测到了这一点（BLOCKED-351）。对这条命令，它让 P0-01 的 must[1]「将审计 SHA 写入文档和机器文件；任何执行批次开始前必须 verify，发现上游漂移时停止并生成 rebase report。」fail open（BLOCKED-305）。对 `dsh` 本身，就是一条什么都不跑却报告成功的命令。

## 决定

- **每个入口都拿 `process.argv[1]` 与自己的文件比较**，与 `scripts/clean.ts`、`scripts/first100/verify-adapt-dispositions.mjs` 已有的写法相同：`resolve(process.argv[1])` 对 `fileURLToPath(import.meta.url)`。
- **经符号链接启动的入口比较真实路径**，比较之前先确认 `argv[1]` 指向一个文件：`apps/cli/src/bin.ts`（`dsh` 的 bin 链接）、`packages/subprocess/subprocess-local/src/bin.ts`，以及桌面应用从 `node_modules` 启动的 `apps/desktop-host/src/index.ts`。Node 给主模块的 URL 是真实路径。打包的 SDK 运行时会 import `lib/bin.js` 并自己调用 `runCli()`，那时 `argv[1]` 可能是参数而不是文件，检查不能抛错。
- **engines 范围不变。** delegate 保留了它，因为仓库已有的守卫本来就是按整个范围写的。
- 逐文件的归属：
  - P0-01（BLOCKED-305）：`scripts/release/baseline-fingerprint.mjs`、`scripts/release/collect-evidence.mjs`、`scripts/release/verify-evidence.mjs`。
  - BLOCKED-351：`apps/cli/src/bin.ts`、`apps/desktop-host/src/index.ts`、`packages/subprocess/subprocess-local/src/bin.ts`、`apps/desktop/scripts/prepare-package-set.ts`，以及 `scripts/` 下的 `benchmark-next-package-dependency.ts`、`benchmark-npm-resolution.ts`、`build.ts`、`run-gates.ts`、`verify-cordis-config.ts`、`verify-doc-site-fragments.ts`、`verify-npm-install-layout.ts`、`verify-package-dependencies.ts`、`verify-package-readme-summaries.ts`、`verify-runtime-closure.ts`。

## 已考虑的替代方案

- **把 engines 下限提到带 `import.meta.main` 的 Node 24 版本。** 代码做不到的范围会误导用户，而仓库自己的守卫已经覆盖整个范围。
- **`import.meta.filename`。** 它在整个范围内都可用，但仓库的守卫比较的是 `fileURLToPath(import.meta.url)`，只保留一种写法。

## 后果

- 在 Node v24.0.0 上，`dsh`、`baseline:verify` 与各门脚本的行为与后来的版本一样。在这次修复上再跑一次 workflow 输入 `node_version_probe`，是 BLOCKED-351 的关闭条件 4。
- 本 note 部分取代 [证据校验重新推导基线、绑定门禁清单并报出 accepted 状态](2026-09-24-evidence-verification-rederives-the-baseline-and-binds-the-gate-manifest.zh.md)：它关于 `import.meta.main` 守卫的那一条已不成立。
