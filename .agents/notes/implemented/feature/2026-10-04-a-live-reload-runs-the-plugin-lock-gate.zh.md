# Agent Note: 热重载也跑插件锁门

Status: implemented

[English](2026-10-04-a-live-reload-runs-the-plugin-lock-gate.md) | 中文

## Problem

A-550 把插件锁门（P1-03 must[2]）放在 `composeProfile` 里，所以它只在启动时运行。在 `patchReload: "live"` 的 profile 上，`composeLive` 重组每一代时只经过补丁行准入，不经过锁门；于是编辑进 `cordis.patch.yml` 的一行，若指向 profile 自己 `node_modules` 里一个没入锁的包，重载时就会被挂上（BLOCKED-359）。

## Decision

- `composeLive`（`apps/cli/src/profile-boot.ts`）对每一代都运行 `enforceProfileLock`，使用启动时准入的 bundle 层和组合后每一行的模块。锁不符就抛错，整代被拒：HMR 让已挂载的树保持上一代，并带着原因发出 `hmr/config-update-failed`。这与启动时锁不符就拒绝整个 profile 一致。
- `watchUserPatches`（`@deepseek-ai/dsh-app-boot`）接受异步的 `compose`，在更新根 Include 之前等待它；被拒绝时，这一代与解析失败一样被整代拒绝。
- 拒绝信息写明拒的是什么：「refusing to boot」或「refusing to reload」。

## Alternatives considered

- **只拒有问题的行。** 要把锁的拒绝结果映射回行，而且与启动时整体拒绝的语义不一致。
- **给重载路径另写一个同步的锁检查。** 会与 `gateProfileAgainstLock` 重复。

## Consequences

- 一次热编辑若挂上锁里没有的包，profile 会停在上一代，直到用 `dsh plugin` 把这个包入锁。
- HMR 的模块重载根仍会在不经锁门的情况下重载已加载包的改动代码；`@deepseek-ai/dsh-base` 关掉了模块重载，CLI 只挂一个只看配置的实例，所以出厂 profile 不会重载模块（记在 `@deepseek-ai/dsh-plugin-lock` 的已知限制里）。
