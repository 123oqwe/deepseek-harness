# packInstall EXIT_0_CAPTURED — first real green (R0.3A)

English | [中文](packinstall-exit0-e5e9a5abf7.zh.md)

Status: EXIT_0_CAPTURED. R0 exit gate item 1's `packInstall` row closes for
real: a genuine Linux CI run of the official-profile build, pack (both
release families), and verify-packed-install, at the frozen baseline
`0a53fb55`, all real exit 0.

## 1. Identity

- Candidate SHA: `e5e9a5abf71992388370c6226c218338d689752d` (branch `first100-exec`)
- CI: `.github/workflows/first100-exact-sha.yml`, run [33423117821](https://github.com/123oqwe/deepseek-harness/actions/runs/33423117821), job `install / typecheck / test @ exact SHA`
- Runner: GitHub-hosted `ubuntu-latest`, Node 24

## 2. Command / exit / evidence

| step | command | real exit | evidence (raw CI log) |
|---|---|---|---|
| build (official client profile, the exact env CI's build gate sets) | `DSH_BUILD_CLIENT_PROFILE=official pnpm run build` | **0** | job step "Build (official client profile, the exact env CI's build gate sets)" green |
| pack — dsh family | `pnpm run release:pack --family dsh` | **0** | `release pack: family dsh, 245 tarball(s) in dist/npm` |
| pack — vendor family | `pnpm run release:pack --family vendor --out dist/npm-vendor` | **0** | `release pack: family vendor, 9 tarball(s) in dist/npm-vendor` |
| verify-packed-install (real throwaway consumer, real npm install + entry probe) | `pnpm run release:verify-packed-install --family dsh --from dist/npm --from dist/npm-vendor` | **0** | `release verify-packed-install: installing 254 tarball(s) into /tmp/dsh-packed-dsh-krTxNR` then `release verify-packed-install: installed @deepseek-ai/dsh reports 0.1.2-alpha.2` |

245 + 9 = 254 tarballs packed and installed — matches exactly.

## 3. Contrast with the retired macOS-local receipt

`docs/audit/baseline-b150a551.md` (superseded, retired baseline `b150a551b8`)
recorded `verify-packed-install` exiting 1 on this Supervisor's local macOS
host for two documented, non-payload reasons: a stale local npm cache
capping a transitive dependency's visible version, and koffi's
darwin-arm64-only optional-dependency prebuilt being dropped by
`--omit=optional`. Both are host-environment specific. This receipt is the
first real confirmation that neither applies on Linux CI: the exact same
`verify-packed-install` script, run against a cold npm cache on a Linux
runner, exits 0 cleanly.

The Supervisor also hit the same class of stale-cache issue locally while
preparing this CI change (a different package, `@agentclientprotocol/sdk`,
this time) and confirmed via `npm view --prefer-online` that the version
genuinely exists upstream before trusting that CI — with its always-cold
cache — would not reproduce it. It didn't.

## 4. Honesty — what this receipt does and does not establish

- **Does establish:** both `nativeTestFullSuite` (already closed,
  `docs/audit/nativetestfullsuite-exit0-2b82aba798.md`) and now
  `packInstall` genuinely meet `EXIT_0_CAPTURED`. R0 exit gate item 1, as a
  whole ("clean-branch native CI/pack to be green on the frozen baseline"),
  is now fully satisfied by real CI evidence.
- **Does NOT establish:** `independentReviewReceipts` — the remaining R0
  row, and not something a CI workflow can produce: it requires a genuine
  independent (fresh-context, no-Writer-context) review procedure per
  maintainer decision C1's Reviewer discipline.
- First-100 remains 0/109 ACCEPTED; W1 remains BLOCKED until
  `independentReviewReceipts` is captured too.
