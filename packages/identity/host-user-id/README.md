---
description: "The stable identifier of the host user a harness home belongs to, so an action recorded by the harness names a real actor rather than one invented at the point of use."
kind: "package-reference"
---

# @deepseek-ai/dsh-host-user-id

English | [中文](README.zh.md)

## Summary

Every harness home has one host user — the person whose `$DSH_HOME` it is — and this package supplies the identifier that names them. A shipped boot attaches it as the session's `UserPrincipal`, so each action the harness records is attributed to that person and a workspace trust upgrade has somebody to be granted on behalf of. The value is a random UUID stored in `$DSH_HOME/.host-user-id` (`~/.dsh` by default); it appears on first use, stays stable across restarts, and is minted afresh if you delete the file. It is deliberately **not** the anonymous telemetry id: that one is shipped to receiving systems, this one authorizes changes, and they are separate files for that reason.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

There is nothing to install or configure: a shipped boot resolves the id and attaches it, and the value appears the first time a harness launches. Use this package when you are building a boot path that must say who is acting, or a feature that must ask whether the current actor is the host user.

### What the id does for you

- **Every action names an actor.** An action manifest records the principal it ran under. Without an attached identity the dispatch paths synthesize an anonymous one named after the session, and a log of those cannot be traced to a person.
- **A trust upgrade has somebody to authorize it.** `/trust-skills` and the project-instruction trust question both refuse a non-host principal, so without this id they refuse every time.
- **Records line up across launches.** The same home is the same host user tomorrow, so a change authorized last week and one authorized today name one person.

### Observing and resetting the id

The id lives in `$DSH_HOME/.host-user-id` (`~/.dsh` by default) as a plain UUID text file. Delete it to become a new host user at the next launch; the running process keeps its current id until it exits. Separate harness homes are separate host users, and no machine or account detail goes into the value.

### Using it in your own package

```ts
import { getOrCreateHostUserId } from '@deepseek-ai/dsh-host-user-id'

const id = getOrCreateHostUserId() // stable for the process lifetime
```

The value is stable for the process. Even when the home cannot be written, it still works for the current run, so a boot on a read-only home is not blocked — it simply acts as a host user whose id is new each launch.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Why this is not the anonymous telemetry id

`@deepseek-ai/dsh-anonymous-user-id` mints the same kind of value in the same home, and reusing it was the obvious move. It was rejected on measurement: that id rides model requests as `user`, is exported as an OTel `user.id` resource attribute, and is printed to the user by `/feedback` as *"Anonymous user"*. It is a **telemetry subject**. The value here is an **authorization subject** — the `UserPrincipal.id` a trust upgrade is granted under and the actor an audit trail names. One uuid serving both would mean the value a deployment ships to a telemetry backend is the value its audit trail names as the human who authorized a change. Same mechanism, same home, two files, two roles.

### Design philosophy

- **Random, never derived.** `crypto.randomUUID()`; never the OS username, hostname, network address, or git remote. An OS username is a display concern and does not belong in an identifier that must not collide across homes.
- **Synchronous and memoized.** Boot-time consumers use one API, and one process touches the disk once.
- **Best-effort persistence, with its consequence stated.** An unwritable home still yields a usable id, so the boot proceeds; that run's actions stay traceable within the run and cannot be correlated across runs.
- **Library, not plugin.** No Cordis entry, no config. No invariant companion is published: the package owns one private memo and one best-effort file, with no independent observation to compare against without creating the id as a side effect.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Library entry: `getOrCreateHostUserId`, file persistence, per-path memoization |
| — | No runtime invariant companion is published; see the design philosophy above. |
| [`tests/host-user-id.spec.ts`](tests/host-user-id.spec.ts) | Exercised behavior: mint, persistence, corruption, concurrency, memoization, and separation from the telemetry id |

### Storage contract

A bare UUID line named by `HOST_USER_ID_FILE_NAME`, validated against a UUID pattern on read. A first writer uses exclusive creation (`wx`); a concurrent loser rereads and adopts the winner. A corrupt or unreadable file falls through to mint-and-overwrite. Memoization is keyed by resolved file path, so distinct homes never share an id.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [identity group map](../README.md) — the sibling packages and group scope.
- [dsh-principal](../principal/README.md) — `UserPrincipal`, the delegation chain, and `isHostUserPrincipal`.
- [dsh-anonymous-user-id](../anonymous-user-id/README.md) — the telemetry id this one is deliberately separate from.
- [dsh-home-paths](../../util/home-paths/README.md) — owns `$DSH_HOME` and `~/.dsh` resolution.
- [dsh-workspace-trust-local](../../workspace/workspace-trust-local/README.md) — the provider that persists what this principal grants.

-----

<a id="model-experience"></a>
## Model Experience

### The host user's identifier

#### What the model sees

Nothing. The id registers no tool, injects no prompt, and reaches no request field. What it changes is the actor recorded beside the model's actions — the `actor` on each `ActionManifest` and the `identity/attached` session event — which the model never reads.

#### Token effect

None. Nothing this package produces enters a request.

#### KV Cache effect

None. The value is absent from the model-visible prefix, so it cannot invalidate it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No recovery after deletion** — losing the file makes the next launch a different host user by design; recovery would need stable derivation material, which would tie the identifier to the machine.
- **One host user per home, not per OS account** — two OS accounts sharing a `$DSH_HOME` are one host user here, and one account with two homes is two. The home is the scope because the home is what the harness owns.
- **No display name** — the value is a uuid and nothing renders a human-readable name beside it. A surface that shows a user needs one; this package does not invent it, because a display field with no reader is a field nobody maintains.
- **Best-effort concurrency** — a reader landing between a concurrent process's exclusive create and completed write can use a different in-memory uuid for that run; later launches converge on the persisted value.
- **An unwritable home is not reported** — the boot proceeds with a per-run id rather than refusing, and nothing tells the operator that this run's actor will not match the next run's.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions that are not decided. Shipped behavior and accepted rationale live in the sections above.

#### Open: which roots attach

A shipped boot attaches this id for the launcher family a local host user actually drives. ACP, the SDK server, and webhook ingress deliberately do not: a request arriving over a socket is not the machine's host user, and attaching there would make a remote caller claim to be them. Whether those paths get an identity of their own, and from where, is not settled here.

#### Open: an unwritable home should probably say so

Persistence is best-effort, which is right for not blocking a boot and wrong for silence. Where that warning belongs — this package, the boot glue, or a settings diagnostic — is undecided.

</details>
