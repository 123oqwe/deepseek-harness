---
description: "Scans decoded attachment payloads for malicious content before a parser or the model sees them, for maintainers wiring attachment security into a composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-attachment-security

English | [中文](README.zh.md)

## Summary

A malicious-content scanner for decoded attachment payloads (Epic P3-12 must[1]). It implements the `AttachmentScanner` seam (`ctx.attachmentScanner`, declared by `@deepseek-ai/dsh-attachment`) and classifies one payload before any parser or the model sees it, refusing a declared-vs-sniffed media-type mismatch, an over-ratio decompression (zip bomb), a polyglot, a pixel bomb, excess archive nesting, a macro-bearing document, and a native executable.

It reads leading magic numbers and ZIP central-directory metadata only — it never decompresses a payload to inspect it, so the scanner is not itself an expansion surface for a bomb.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount it in a composition so the attachment store can consult it:

```yaml
- id: attachment-security
  name: '@deepseek-ai/dsh-attachment-security'
  config:
    maxDecompressionRatio: 100
    maxNestingDepth: 1
    maxPixels: 64000000
```

`ctx.attachmentScanner.scan({ bytes, declaredMediaType })` returns `{ admit: true }` or `{ admit: false, refusal: { kind, detail } }`, where `kind` is one of `mime-mismatch`, `decompression-ratio`, `polyglot`, `pixel-bomb`, `nesting-depth`, `macro`, or `executable`.

### Configuration

Every threshold is a deployment-resolved field; none is hardcoded in the detectors.

| Field | Default | Meaning |
| --- | --- | --- |
| `maxDecompressionRatio` | `100` | Largest total-uncompressed to compressed ratio an archive may declare. |
| `maxNestingDepth` | `1` | Deepest archive-within-archive nesting admitted; `0` forbids any nested archive. |
| `maxPixels` | `64000000` | Largest intrinsic width times height admitted for a raster image. |

<a id="understand-the-implementation"></a>
## Understand the implementation

### Source map

| File | Responsibility |
| --- | --- |
| [`src/index.ts`](src/index.ts) | The `AttachmentSecurityScanner` service, its `Config`, and the `DEFAULT_*` resolve defaults. |
| [`src/scanner.ts`](src/scanner.ts) | The magic-number sniffer and the seven detectors behind `scanPayload`. |

### Design decisions

- **The decision belongs to the store's save path, not to this provider.** This package returns a verdict; a later slice invokes it inside the attachment store's save operation, so a direct store caller cannot reach a parser with an unscanned payload (the admission entry alone is a narrower, bypassable check).
- **No decompression.** Archive checks read declared sizes and entry names from the ZIP central directory through `fflate`'s extraction filter, which never inflates a member. The ratio check clears a level before any nested archive is read.

<a id="further-exploration"></a>
## Further Exploration

- [Attachment subsystem reference](../../../docs/subsystems/attachment.md) — the `ctx.attachments` service contract this scanner guards.
- [Capability seams](../../../docs/capability-seams.md) — the Service Definition / Provider / Consumer split this family follows.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **The store wiring is a separate slice.** This package ships the `AttachmentScanner` provider; wiring the scan into `AttachmentStore.saveImages`/`saveFile` (so no provider override bypasses it) is the follow-on slice that refactors those into scan-then-commit templates.
- **WebP carries no pixel-bomb check here.** The sniffer recognizes WebP, but its dimensions are not parsed; a WebP pixel bomb is not yet refused.
- **Nesting is read through bounded decompression of nested-archive members only.** Depth is measured by recursing into members whose name is an archive, after the ratio check clears each level; a nested archive disguised under a non-archive name is not recursed into.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: undecided directions and open questions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and the package code.

The store-side enforcement (slice 2, wiring the scan into `AttachmentStore`'s save templates) and the WebP pixel-bomb and name-disguised recursive-nesting detectors are the open work; see Known Limitations and Deferred Work above.

</details>
