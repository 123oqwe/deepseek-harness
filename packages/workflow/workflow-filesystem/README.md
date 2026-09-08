---
description: "Saved workflow definitions loaded from the harness home at boot: one file per definition, digest computed from the bytes read, registered through the engine's own admission."
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-filesystem

English | [中文](README.zh.md)

## Summary

`dsh-workflow-filesystem` makes a saved workflow a **file**. At mount it reads every `.js` and `.mjs` file under the harness home's `workflows` directory and registers each one with the mounted engine, in the same shape `@deepseek-ai/dsh-skill-filesystem` uses to turn a directory of Markdown files into skills.

Registering is not executing. A definition's body reaches the engine as a string and is stored as one; nothing here compiles, evaluates or imports it. That is Epic P4-09's acceptance[0], and it is what makes it safe to read a directory the model can write to.

## Table of Contents

- [Use this package](#use-this-package)
- [What protects a run](#what-protects-a-run)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Use this package

Mount it beside a workflow engine; it takes no configuration.

```yaml
- name: '@deepseek-ai/dsh-workflow-worker-thread'
- name: '@deepseek-ai/dsh-workflow-filesystem'
```

Each file becomes one definition. Its **name is the file's base name**, never a field inside the body: a body that named itself would be a definition asserting its own identity, and the registry keys version history by name, so a body that renamed itself between versions would split its own history in two.

The directory is `<harness home>/workflows`, derived rather than configured. Which directory a deployment keeps its workflows in is not a choice a profile needs to vary, and a second location would mean two answers to "where does this definition come from" for one run.

Mounting resolves once the loader has offered every file to the engine, so a run that nests a saved workflow cannot depend on whether a load happened to finish first. A missing directory yields no definitions rather than an error — a deployment that has saved no workflows is the ordinary case.

## What protects a run

Not this plugin's caution — the engine's registration check. The digest is computed from the bytes read, so "the file changed" and "the definition changed" cannot come apart, and a definition claiming a digest it does not hash to is not expressible through this path at all. The engine then recomputes it and refuses a mismatch, and refuses a self-recursive definition before it can be started.

A refused file is recorded on `ctx.savedWorkflows.refused` with its name and the reason, and the load continues. One malformed file must not stop a harness from starting, and an operator needs to know which file was rejected and why.

Mounting over an engine with no registration surface is refused loudly, because saved workflows would otherwise load into nothing and the composition would look correct.

## Model Experience

None, as this package reads definition files and registers them and registers nothing model-facing.

#### KV Cache effect

Nothing here enters a model request, so provider cache reuse is unaffected. What it loads reaches a model only through the `workflow` tool's own surface.

## Known Limitations and Deferred Work

- **The signer is the loader, and it attests nothing.** A file gets `signer: 'workflow-filesystem'` because that is the only provenance this build can honestly claim — there is no signature root to verify a stronger one against. Nothing here may be read as evidence a saved definition came from a trusted author.
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
