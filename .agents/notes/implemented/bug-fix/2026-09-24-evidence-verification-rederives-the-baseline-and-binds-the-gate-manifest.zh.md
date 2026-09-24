# Agent Note: 证据校验重新推导基线、绑定门禁清单并报出 accepted 状态

Status: implemented

[English](2026-09-24-evidence-verification-rederives-the-baseline-and-binds-the-gate-manifest.md) | 中文

## 问题

`scripts/release/verify-evidence.mjs` 会按包里记录的摘要重新计算 `.dsh/baseline.json` 的摘要，却从不根据检出重新推导这份文件记录的指纹。所以采集之后改动了指纹覆盖的文件，只要 `.dsh/baseline.json` 本身没动，校验照样通过（BLOCKED-304）。旁车 `manifest.json` 列出 `collect-evidence.mjs init` 时声明的必需门禁 id 与制品路径，它也没有绑定到包上，采集之后改它同样能通过。此外，校验器的结果行写了包路径，却没写它的 `accepted` 状态，而这是引用这道门禁的报告要写的第二个事实。

## 决策

- **校验时重新推导基线。** `.dsh/baseline.json` 仍与记录的摘要一致时，`verify` 对检出调用 P0-01 的 `verifyBaseline`，把每一项漂移报为不一致。
- **门禁清单绑定到包上。** `collect-evidence.mjs init` 在签名之前写出 `manifest.json`，并把它的摘要记为包的可选字段 `sidecarManifestDigest`，包签名覆盖这个字段。清单摘要不符，或包里缺这个字段，`verify` 都报不一致。
- **只有校验通过、且记录的是布尔值 `true` 的包，结果行才写 `accepted=true`。** 校验失败的包写 `accepted=false`，记录的值只用文字说明；`accepted` 不是布尔值，本身就是一项不一致。
- **工作树与记录的 diff 对照。** `init` 记录工作树的 `git diff <baseSha>`，`verify` 再取一次同样的 diff 并比对摘要，所以采集之后改动的受跟踪文件，无论提交与否，都会让校验失败。
- **做不了的核对记为具名的不一致。** 缺 git 或 pnpm、目录不是 git 检出、包或清单不是合法 JSON，都记为一项不一致，所以结果行总会打印。

## 考虑过的替代方案

- **把工具链字段排除在漂移之外。** 未采用：最小的改动是保持 P0-01 的指纹完整。因此离线复核需要采集时检出的 HEAD、Node 与 pnpm，exact-SHA 工作流的上传注释已写明这一点。
- **把 `sidecarManifestDigest` 设为必需字段。** 未采用：冻结的 Contract 阶段用例构造的包字面量里没有它，设为可选字段能让这些用例继续成立，而 `verify` 照样拒绝缺这个字段的包。

## 后果

- 离线复核必须在采集时检出的 HEAD 上，用相同版本的 Node 与 pnpm 运行；否则都报为漂移。发现漂移时，`verifyBaseline` 会写出 `.dsh/rebase-report.json`。
- 每次校验都会运行 `git`、`node --version` 与 `pnpm --version`。
- 本改动之前采集的包没有 `sidecarManifestDigest`，会校验失败。
- `git diff` 只覆盖受跟踪的文件，所以采集之后新增的未跟踪文件看不到。在 `init` 与 `verify` 之间改动受跟踪文件的步骤会让校验失败；exact-SHA 门禁在两者之间只跑 typecheck 这一个门。
- `main()` 在 `import.meta.main` 守卫之后运行，所以在没有 `import.meta.main` 的 Node 版本上，脚本什么也不做、以 0 退出。这是修复之前就有的问题，由 BLOCKED-305 跟踪。
- 修复的提交是 `775c25640a`。后来的一条提交信息引用的 `bed753dfe2` 是本笔记的文档提交。
