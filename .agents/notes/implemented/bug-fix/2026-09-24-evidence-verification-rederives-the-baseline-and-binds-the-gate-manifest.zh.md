# Agent Note: 证据校验重新推导基线、绑定门禁清单并报出 accepted 状态

Status: implemented

[English](2026-09-24-evidence-verification-rederives-the-baseline-and-binds-the-gate-manifest.md) | 中文

## 问题

`scripts/release/verify-evidence.mjs` 会按包里记录的摘要重新计算 `.dsh/baseline.json` 的摘要，却从不根据检出重新推导这份文件记录的指纹。所以采集之后改动了指纹覆盖的文件，只要 `.dsh/baseline.json` 本身没动，校验照样通过（BLOCKED-304）。旁车 `manifest.json` 列出 `collect-evidence.mjs init` 时声明的必需门禁 id 与制品路径，它也没有绑定到包上，采集之后改它同样能通过。此外，校验器的结果行写了包路径，却没写它的 `accepted` 状态，而这是引用这道门禁的报告要写的第二个事实。

## 决策

- **校验时重新推导基线。** `.dsh/baseline.json` 仍与记录的摘要一致时，`verify` 对检出调用 P0-01 的 `verifyBaseline`，把每一项漂移报为不一致。
- **门禁清单绑定到包上。** `collect-evidence.mjs init` 在签名之前写出 `manifest.json`，并把它的摘要记为包的可选字段 `sidecarManifestDigest`，包签名覆盖这个字段。清单摘要不符，或包里缺这个字段，`verify` 都报不一致。
- **结果行报出 accepted 状态。** 成功行与失败行都在包路径旁写出 `accepted=<值>`。

## 考虑过的替代方案

- **把工具链字段排除在漂移之外。** 未采用：最小的改动是保持 P0-01 的指纹完整。因此离线复核需要采集时检出的 HEAD、Node 与 pnpm，exact-SHA 工作流的上传注释已写明这一点。
- **把 `sidecarManifestDigest` 设为必需字段。** 未采用：冻结的 Contract 阶段用例构造的包字面量里没有它，设为可选字段能让这些用例继续成立，而 `verify` 照样拒绝缺这个字段的包。

## 后果

- 离线复核必须在采集时检出的 HEAD 上，用相同版本的 Node 与 pnpm 运行；否则都报为漂移。发现漂移时，`verifyBaseline` 会写出 `.dsh/rebase-report.json`。
- 每次校验都会运行 `git`、`node --version` 与 `pnpm --version`。
- 本改动之前采集的包没有 `sidecarManifestDigest`，会校验失败。
