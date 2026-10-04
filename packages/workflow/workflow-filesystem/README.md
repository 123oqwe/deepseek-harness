---
description: "Saved workflow definitions loaded from the harness home at boot: one file per definition, registered only when its signature verifies against a configured trust anchor, through the engine's own admission."
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-filesystem

English | [中文](README.zh.md)

## Summary

`dsh-workflow-filesystem` makes a saved workflow a **file**. At mount it reads every `.js` and `.mjs` file under the harness home's `workflows` directory and registers each one with the mounted engine, in the same shape `@deepseek-ai/dsh-skill-filesystem` uses to turn a directory of Markdown files into skills.

Registering is not executing. A definition's body reaches the engine as a string and is stored as one; nothing here compiles, evaluates or imports it. That is Epic P4-09's acceptance[0], and it is what makes it safe to read a directory the model can write to.

Only a signed definition registers. A definition loads when the signature file beside it names the digest of the bytes read and its signature verifies against one of the deployment's offline-signed trust anchors; every other definition is refused and logged.

## Table of Contents

- [Use this package](#use-this-package)
- [Sign a saved workflow](#sign-a-saved-workflow)
- [What protects a run](#what-protects-a-run)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

The shipped base layer mounts it beside the workflow engine, and the cordis, ptc and standard presets mount it beside their own engines; it takes no configuration.

```yaml
- name: '@deepseek-ai/dsh-workflow-worker-thread'
- name: '@deepseek-ai/dsh-workflow-filesystem'
```

Each file becomes one definition. Its **name is the file's base name**, never a field inside the body: a body that named itself would be a definition asserting its own identity, and the registry keys version history by name, so a body that renamed itself between versions would split its own history in two.

The directory is `<harness home>/workflows`, derived rather than configured. Which directory a deployment keeps its workflows in is not a choice a profile needs to vary, and a second location would mean two answers to "where does this definition come from" for one run.

Mounting resolves once the loader has offered every file to the engine. A host composition awaits that before its first turn; a preset composition does not, and can publish a session while the load is still running. `ctx.savedWorkflows.settled` resolves once the directory has been read, with the reason when the read failed, and the `workflow` tool waits on it before it lists the saved workflows to a model (B-729). A missing directory yields no definitions rather than an error — a deployment that has saved no workflows is the ordinary case.

## Sign a saved workflow

A definition file `<name>.js` (or `.mjs`) loads only with a signature file `<name>.js.sig.json` beside it:

```json
{ "digest": "sha256-…", "publicKeyFingerprint": "sha256:…", "signature": "<base64>" }
```

- `digest` is `computeDefinitionDigest(body)` from `@deepseek-ai/dsh-workflow-registry`, computed over the definition file's exact contents.
- `signature` is the signature over the digest string's UTF-8 bytes, made with the private key of an offline-signed trust anchor and written in base64. For an Ed25519 key that is `crypto.sign(null, Buffer.from(digest), privateKey)`.
- `publicKeyFingerprint` names that anchor.

The anchors are the profile's own: the profile `package.json`'s `dsh.trustAnchors`, each `{ "mode": "offline-signed", "publicKeyFingerprint": …, "owner": …, "publicKeyPem": … }`, which the boot hands to the Trust Kernel. Only the public key is configured; the private key that signs stays with whoever signs the definitions. A registered definition records the anchor's `owner` as its signer.

## What protects a run

First the signature, checked before the engine sees anything. A definition is refused, and the reason is recorded and logged, when its signature file is missing (`unsigned`), when the digest it names is not the one computed from the bytes read (`digest-mismatch`), when no Trust Kernel is pinned or none of its offline-signed anchors has the named fingerprint (`no-trust-anchor`), or when the file is not a signature or the signature does not verify against that anchor's key (`signature-invalid`). Each refusal names the file and points to this README.

Then the engine's registration check. The digest is computed from the bytes read, so "the file changed" and "the definition changed" cannot come apart. The engine recomputes it and refuses a mismatch, and refuses a self-recursive definition before it can be started.

A refused file is recorded on `ctx.savedWorkflows.refused` with its name and the reason, and the load continues. One malformed file must not stop a harness from starting, and an operator needs to know which file was rejected and why.

Mounting over an engine with no registration surface is refused loudly, because saved workflows would otherwise load into nothing and the composition would look correct.

## Model Experience

None, as this package reads definition files and registers them and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected. What it loads reaches a model only through the `workflow` tool's own surface.

## Known Limitations and Deferred Work

- **A shipped profile loads no saved workflow until it configures an anchor.** No shipped profile declares `dsh.trustAnchors`, so every saved definition is refused and logged until an operator adds an offline-signed anchor and signs the definitions as above.
- **Only offline-signed anchors verify a saved definition.** A Sigstore anchor in `dsh.trustAnchors` is not consulted here.
- **Every file registers at version 1.** The loader has no notion of version history: re-saving a file with a changed body registers a new digest under the same name, and a file whose body is unchanged is refused as `already-registered`. Version numbering belongs to whatever writes the directory.
- **The directory is read once, at mount.** A file added while the harness is running is not picked up; `dsh-skill-filesystem` watches its roots and this does not.

No runtime invariant companion is published: this plugin holds one list of what it loaded and observes nothing else, so a checker would compare that list against itself rather than reconcile two independent observations.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior and limits live in the sections above and in the package code.

Registration is not on the `WorkflowEngine` seam, so this loader names the one operation it needs structurally and refuses to mount over an engine that lacks it. Moving `RegisteredDefinition` down into `@deepseek-ai/dsh-workflow` would let the seam declare `registerDefinition` and remove the structural check; measured, that move touches ten files, all inside the two workflow packages and their tests. Whether the seam should carry registration — which would oblige every engine to implement it — is undecided, and the structural port is the smaller commitment until it is decided.

</details>
