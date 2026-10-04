# Agent Note：Desktop Host 封存钉住的 kernel 的信任锚

Status: implemented

[English](2026-10-04-the-desktop-host-seals-the-pinned-kernels-trust-anchors.md) | 中文

## 问题

`runProfile` 在 `pinTrustKernel` 之后立即封存钉住的 Trust Kernel 的锚集，插件因此无法在它够得到的 kernel 上登记或撤销信任锚（P1-02 must[3]）。Desktop Host 钉住了 kernel 却没有封存，所以在 Desktop Host 启动时，插件仍能改动这些锚（B-708；P1-02 增量复核 2-1）。

## 决定

- Desktop Host 在 `pinTrustKernel` 之后立即调用 `sealTrustAnchors(kernel.signatureRoots)`，与 `runProfile` 的调用相同。
- `apps/desktop-host` 为此依赖 `@deepseek-ai/dsh-plugin-provenance`。

## 考虑过的替代方案

- **不封存 Desktop Host，记一条 Known Limitation。** 修法只是调用 `runProfile` 已在用的机制，记成限制只会留下这个缺口，省不下什么工作。

## 后果

- 在 Desktop Host 启动时，`registerTrustAnchor` 与 `revokeTrustAnchor` 拒绝改动钉住的 kernel 的锚，与 `dsh` profile 启动时一样。
