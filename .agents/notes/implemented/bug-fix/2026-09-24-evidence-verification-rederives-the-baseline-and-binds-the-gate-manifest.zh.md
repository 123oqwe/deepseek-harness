# Agent Note: 证据校验重新推导基线、绑定门禁清单并报出 accepted 状态

Status: implemented

[English](2026-09-24-evidence-verification-rederives-the-baseline-and-binds-the-gate-manifest.md) | 中文

## 问题

`scripts/release/verify-evidence.mjs` 会按包里记录的摘要重新计算 `.dsh/baseline.json` 的摘要，却从不根据检出重新推导这份文件记录的指纹。所以采集之后改动了指纹覆盖的文件，只要 `.dsh/baseline.json` 本身没动，校验照样通过（BLOCKED-304）。旁车 `manifest.json` 列出 `collect-evidence.mjs init` 时声明的必需门禁 id 与制品路径，它也没有绑定到包上，采集之后改它同样能通过。此外，校验器的结果行写了包路径，却没写它的 `accepted` 状态，而这是引用这道门禁的报告要写的第二个事实。

## 决策

- **校验时重新推导基线。** `.dsh/baseline.json` 仍与记录的摘要一致时，`verify` 对检出调用 P0-01 的 `verifyBaseline`，把每一项漂移报为不一致。
- **门禁清单绑定到包上。** `collect-evidence.mjs init` 在签名之前写出 `manifest.json`，并把它的摘要记为包的可选字段 `sidecarManifestDigest`，包签名覆盖这个字段。清单摘要不符，或包里缺这个字段，`verify` 都报不一致。
- **只有校验通过、且记录的是布尔值 `true` 的包，结果行才写 `accepted=true`。** 校验失败的包写 `accepted=false`，记录的值只用文字说明；`accepted` 不是布尔值，本身就是一项不一致。
- **包绑定的是最后一个采集步骤结束时的工作树。** 每一步（`init`、`run`、`build-artifact`）都记录 `git diff --binary <baseSha>`，连同 git 不忽略的每个未跟踪文件、以及每个未跟踪的 `.gitignore`（无论是否被忽略）相对 `/dev/null` 的补丁，但不含包自身的文件与 sidecar 目录。`verify` 再取一次同样的补丁并比对摘要，所以最后一步之后的改动，无论是已提交、未提交、新增的未跟踪文件，还是一个连自己也忽略掉的新 `.gitignore`，都会让校验失败。
- **补丁是 git 自己从工作树取出的。** 两处 diff 都带 `--no-ext-diff --no-textconv`，git 配置里的外部 diff 程序或 textconv 过滤器都替换不了它。未跟踪文件那次调用的 `--no-textconv` 是防御性加固，没有敏感性证明：textconv 过滤器藏不住未跟踪文件的改动，因为 git 会在补丁的 index 行印出文件真实的 blob id。索引把文件标为 skip-worktree 或 assume-unchanged 的检出会被拒绝，因为 `git diff` 对这类文件读的是索引；git 给不出补丁的未跟踪条目也会被拒绝，例如指向目录的符号链接或嵌套仓库。
- **做不了的核对记为具名的不一致。** 缺 git 或 pnpm、目录不是 git 检出、包或清单不是合法 JSON，都记为一项不一致；包能解析、却缺 `verify` 要读的字段时，报为 `verify could not complete`。所以结果行总会打印。

## 考虑过的替代方案

- **把工具链字段排除在漂移之外。** 未采用：最小的改动是保持 P0-01 的指纹完整。因此离线复核需要采集时检出的 HEAD、Node 与 pnpm，exact-SHA 工作流的上传注释已写明这一点。
- **把 `sidecarManifestDigest` 设为必需字段。** 未采用：冻结的 Contract 阶段用例构造的包字面量里没有它，设为可选字段能让这些用例继续成立，而 `verify` 照样拒绝缺这个字段的包。

## 后果

- 离线复核必须在采集时检出的 HEAD 上，用相同版本的 Node 与 pnpm 运行；否则都报为漂移。发现漂移时，`verifyBaseline` 会写出 `.dsh/rebase-report.json`。
- 每次校验都会运行 `git`、`node --version` 与 `pnpm --version`。
- 本改动之前采集的包没有 `sidecarManifestDigest`，会校验失败。
- 在 `init` 与最后一个采集步骤之间发生的改动，属于包所描述的树，不会被报出。一个门若写出 git 不忽略的文件，这个文件会一并被绑定。
- 被采集时生效的忽略规则所忽略的文件不在绑定范围内。本仓库忽略 `.env`、`mise.toml`、`.vscode/` 等，采集之后改动它们，校验照样通过。树外的规则，即 `.git/info/exclude` 与全局的 `core.excludesFile`，同样算生效的规则：采集之后在那里加一条规则，就能让一个新文件躲过校验。
- 把文件标为 skip-worktree 的检出（稀疏检出就是这样）无法采集；含有指向目录的未跟踪符号链接或嵌套仓库的检出，也无法采集。
- `main()` 在 `import.meta.main` 守卫之后运行，所以在没有 `import.meta.main` 的 Node 版本上，脚本什么也不做、以 0 退出。这是修复之前就有的问题，由 BLOCKED-305 跟踪。
- 修复的提交是 `775c25640a`。后来的一条提交信息引用的 `bed753dfe2` 是本笔记的文档提交。
