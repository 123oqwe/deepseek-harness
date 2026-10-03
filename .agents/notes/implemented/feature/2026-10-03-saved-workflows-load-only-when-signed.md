# Agent Note: Shipped profiles mount the saved-workflow loader, and a definition loads only when its signature verifies

Status: implemented

English | [中文](2026-10-03-saved-workflows-load-only-when-signed.zh.md)

## Problem

No shipped profile mounted `@deepseek-ai/dsh-workflow-filesystem`, and the loader was the only shipped caller of the engine's `registerDefinition`, so on the shipped product `workflow({ name, digest })` resolved nothing and P4-09's saving, loading and nesting had package-level evidence only. The loader also registered every file it read: it computed the digest from the file itself and recorded itself as the signer, so nothing checked who wrote a definition. Question 31 (a), which the user chose on 2026-10-03, mounts the loader in the shipped base layer and checks the signature and digest at load (acceptance[0], "saving and loading never execute unverified code").

## Decision

- `packages/bundle/base/cordis.patch.yml` mounts the loader after the workflow engine; the base bundle and the Python SDK runtime declare it as a dependency.
- Beside each definition file sits `<file>.sig.json`, holding the definition's digest, the fingerprint of the signing key, and the base64 signature over the digest's UTF-8 bytes. The loader refuses a definition when the signature file is missing (`unsigned`), when it names another digest than the bytes read (`digest-mismatch`), when no Trust Kernel is pinned or none of the kernel's offline-signed anchors has the named fingerprint (`no-trust-anchor`), and when the file is not a signature or the signature does not verify against that anchor's key (`signature-invalid`). A refusal is recorded on `ctx.savedWorkflows.refused`, logged, and points to the package README. A verified definition registers with the anchor's owner as its signer.
- The anchors are the profile's `dsh.trustAnchors`, which the boot already hands to the Trust Kernel; the loader reads them with `configuredTrustAnchors`.
- The signature check is P1-02's `checkOfflineSignature`, now exported from `@deepseek-ai/dsh-plugin-provenance` and taking the signed bytes rather than a package claim, so the repository keeps one offline verification.

## Alternatives considered

- **Sign with the Trust Kernel's own key.** The key is generated per process, so a definition saved in one boot could not be verified in the next.
- **A verification function in the Trust Kernel.** P0-02's frozen runtime-surface case lists the kernel's value exports, so a new one needs a supersession, and P1-02's function already does the check.
- **Leave the loader unmounted and narrow P4-09 to the published packages (question 31 (b)).** The user chose (a).

## Consequences

- A shipped profile loads no saved workflow until an operator configures an offline-signed anchor and signs the definitions; each refused definition is logged.
- The frozen loader cases (P4-09 U, `saved-workflows.spec.ts`) keep their titles and assertions; their fixture signs each definition and pins a kernel whose anchor holds the test key.
- A Sigstore anchor does not verify a saved definition.
