# Agent Note: npm 发布作业按证据包核对下载到的 tarball

Status: implemented

[English](2026-10-05-npm-publish-jobs-check-downloaded-tarballs-against-the-evidence.md) | 中文

## Problem

在 `release-publish.yml`、`release-vendor-publish.yml` 与 `node-addon-system-release.yml` 里，pack 作业校验发布证据包并上传 tarball；publish 作业在新的 runner 上下载它们并直接发布，不读证据包。「证据校验不过，发布就完成不了」只靠两个作业之间传递的 artifact 成立（BLOCKED-362）。

## Decision

- pack 作业在上传 tarball 之后，把证据包作为单独的 artifact 上传，并把证据包的 sha256 作为作业输出 `evidence-sha256` 报告。
- 每个 publish 作业下载两者，在发布之前运行 `scripts/release/verify-published-artifacts.mjs`：证据包的 sha256 必须等于作业输出，必须记录 `accepted: true`，下载目录下的文件必须恰好是其 `requiredBuildArtifacts` 的键，每个文件的 sha256 必须等于记录的摘要。这一步没有条件，也没有 `continue-on-error`。
- 脚本只引入 Node 内建模块，因为 node-addon 的 publish 作业不安装依赖。

## Alternatives considered

- **在 publish 作业里重跑 `verify-evidence.mjs`。** 它要从 pack 作业的检出重新推导基线与工作树 diff，新的 runner 上没有这些；它还经 `baseline-fingerprint.mjs` 引入 `js-yaml`。
- **在 `verify-evidence.mjs` 里加一个只核产物的模式。** 仍会引入 `js-yaml`，还要改动已验收的校验器。

## Consequences

- tarball 与 pack 作业记录的不一致，或证据包不是它报告的那一份，publish 作业会在碰到 registry 之前停下。
- 发布侧的核对只在真实发布中运行；它的结构由一条用例固定，脚本的行为由 `scripts/release/verify-published-artifacts.spec.ts` 固定。
