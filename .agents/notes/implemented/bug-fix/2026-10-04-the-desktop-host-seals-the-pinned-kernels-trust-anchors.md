# Agent Note: The Desktop Host seals the pinned kernel's trust anchors

Status: implemented

English | [中文](2026-10-04-the-desktop-host-seals-the-pinned-kernels-trust-anchors.zh.md)

## Problem

`runProfile` seals the pinned Trust Kernel's anchor set right after `pinTrustKernel`, so no plugin can register or revoke a trust anchor on the kernel it reaches (P1-02 must[3]). The Desktop Host pinned the kernel without sealing it, so on a Desktop Host boot a plugin could still change the anchors (B-708; P1-02 incremental review 2-1).

## Decision

- The Desktop Host calls `sealTrustAnchors(kernel.signatureRoots)` right after `pinTrustKernel`, the same call `runProfile` makes.
- `apps/desktop-host` depends on `@deepseek-ai/dsh-plugin-provenance` for it.

## Alternatives considered

- **Leave the Desktop Host unsealed and record a Known Limitation.** The fix is one call to the mechanism `runProfile` already uses, so recording a limitation would keep the gap without saving any work.

## Consequences

- On a Desktop Host boot, `registerTrustAnchor` and `revokeTrustAnchor` refuse the pinned kernel's anchors, as they do on a `dsh` profile boot.
