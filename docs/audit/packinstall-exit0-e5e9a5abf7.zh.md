# packInstall EXIT_0_CAPTURED — 首次真正转绿（R0.3A）

[English](packinstall-exit0-e5e9a5abf7.md) | 中文

Status: EXIT_0_CAPTURED。R0 exit gate item 1 的 `packInstall` 项真正
关闭：在冻结基线 `0a53fb55` 上，一次真实的 Linux CI 运行——official-profile
构建、pack（两个 release family）、verify-packed-install——全部真实
退出码 0。

## 1. Identity

- Candidate SHA：`e5e9a5abf71992388370c6226c218338d689752d`（分支 `first100-exec`）
- CI：`.github/workflows/first100-exact-sha.yml`，run
  [33423117821](https://github.com/123oqwe/deepseek-harness/actions/runs/33423117821)，
  job `install / typecheck / test @ exact SHA`
- Runner：GitHub 托管 `ubuntu-latest`，Node 24

## 2. Command / exit / evidence

| step | command | real exit | evidence (raw CI log) |
|---|---|---|---|
| build（official client profile，即 CI build gate 设置的确切环境）| `DSH_BUILD_CLIENT_PROFILE=official pnpm run build` | **0** | job step "Build (official client profile, the exact env CI's build gate sets)" 绿 |
| pack — dsh family | `pnpm run release:pack --family dsh` | **0** | `release pack: family dsh, 245 tarball(s) in dist/npm` |
| pack — vendor family | `pnpm run release:pack --family vendor --out dist/npm-vendor` | **0** | `release pack: family vendor, 9 tarball(s) in dist/npm-vendor` |
| verify-packed-install（真实 throwaway consumer，真实 npm install + entry probe）| `pnpm run release:verify-packed-install --family dsh --from dist/npm --from dist/npm-vendor` | **0** | `release verify-packed-install: installing 254 tarball(s) into /tmp/dsh-packed-dsh-krTxNR`，随后 `release verify-packed-install: installed @deepseek-ai/dsh reports 0.1.2-alpha.2` |

245 + 9 = 254 个 tarball 被打包并安装——数字完全吻合。

## 3. 与已退役的 macOS 本地 receipt 对比

`docs/audit/baseline-b150a551.md`（已作废，已退役基线 `b150a551b8`）记录
本 Supervisor 的本地 macOS 主机上 `verify-packed-install` 退出码为 1，
原因有两个已记录的、非 payload 本身的因素：一个是本地 npm 缓存过期，
限制了某个传递依赖可见的最新版本；另一个是 koffi 仅限
darwin-arm64 的可选依赖预编译包被 `--omit=optional` 丢弃。两者都是
特定于主机环境的问题。本 receipt 首次真正确认：在 Linux CI 上、
使用冷 npm 缓存运行同一个 `verify-packed-install` 脚本，两者均不
出现，干净退出 0。

本 Supervisor 在准备本次 CI 改动时，本地也遇到过同一类过期缓存问题
（这次是另一个包 `@agentclientprotocol/sdk`），并通过
`npm view --prefer-online` 确认该版本确实存在于上游，才信任 CI（其
缓存始终是冷的）不会复现它。事实也确实如此。

## 4. Honesty — 本 receipt 确立与未确立的事实

- **确立：** `nativeTestFullSuite`（已关闭，见
  `docs/audit/nativetestfullsuite-exit0-2b82aba798.md`）与现在的
  `packInstall` 均真正满足 `EXIT_0_CAPTURED`。R0 exit gate item 1
  整体（"干净分支的原生 CI/pack 在冻结基线上为绿"）现已由真实 CI
  证据完全满足。
- **未确立：** `independentReviewReceipts`——剩余的 R0 行，且不是
  CI workflow 能产出的：按 maintainer 决策 C1 的 Reviewer 纪律，
  它需要一次真正独立（全新上下文、无 Writer 上下文）的 review 流程。
- First-100 仍为 0/109 ACCEPTED；W1 仍处于 BLOCKED，直到
  `independentReviewReceipts` 也被采集。
