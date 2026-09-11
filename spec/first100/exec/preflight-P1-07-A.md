# preFlight — P1-07 (A): the trust boundary that ships switched off

**Status: measurement only. No code written.** Measured at `961dd8fb8e`. This is the remediation slice [BLOCKED-185](BLOCKED-QUEUE.md) opened: the boundary is built, its decisions have real callers, and **no shipped profile has it on**.

## What is NOT wrong here, stated first

Unlike P6-07 and P6-02, this epic's decisions are **not** orphaned. The whole-tree census (`git ls-files`, symbol by symbol, excluding the package's own directory):

| decision | production callers |
| --- | --- |
| `authorizeProjectLoad` | **2** — `context/agent-instructions/src/files.ts:313` and `skill/skill-filesystem/src/index.ts:252-254` |
| `bindWorkspaceTrust`, `reconcileWorkspaceTrust` | **2** — `workspace-trust-local/src/index.ts`, `workspace/src/entity.ts` |
| `requestTrustUpgrade` | **1** — `workspace/src/entity.ts:257`, behind `WorkspaceEntity.upgradeTrust` |
| `downgradeTrust`, `isHostUserPrincipal` | **0** (the package's own tests aside) |

So the shape of this epic's problem is different, and the remediation is different with it. The mechanism works; what is missing is that anything turns it on, and that a host user has any way to say yes.

## The three things measured, in the order they block each other

### 1. The provider ships `disabled: true`, and the two consumers fail OPEN on its absence

`packages/bundle/base/cordis.patch.yml:383-385` mounts `workspace-trust-local` with `disabled: true`. Its comment states the reason plainly and the reason is a real one:

> *"with no grants an enabled provider makes every workspace untrusted at once, which stops project skills and the project's own AGENTS.md loading for every existing user. A boundary that ships on and breaks everyone does not get adopted; this ships discoverable and one edit from on."*

Both consumers then treat an unmounted provider as permission:

- `agent-instructions/src/files.ts:312-315` — `options.trustState !== undefined && !authorizeProjectLoad(...)`, so an **undefined** state skips the gate entirely.
- `skill-filesystem/src/index.ts:252-254` — `const trust = this.ctx.get('workspaceTrust'); if (trust === undefined) return true`.

Each is documented as deliberate, and in isolation each is defensible — a capability nobody mounted is capability absence, which is how the rest of this harness reads an unmounted service. **Together with the disabled row, the composition means acceptance[0] does not hold on any profile a user can launch:** open a repository with a malicious `AGENTS.md` and a project skill, and both load exactly as they did before this epic existed.

That is BLOCKED-185's finding, and it is why this slice cannot be "wire one more consumer". **The default is the subject.**

### 2. must[2]'s host-user interaction does not exist

The clause: *"信任升级必须由宿主用户交互完成并写审计"* — a trust upgrade must be completed by a host-user interaction, and audited.

The audit half is real: `requestTrustUpgrade` refuses a non-host principal (`isHostUserPrincipal`), records a `TrustUpgradeAuditRecord`, and `WorkspaceEntity.upgradeTrust` persists it.

**The interaction half has no producer.** `WorkspaceRegistry.upgradeTrust` (`workspace/src/index.ts:209`) is the only route in, and the census finds **no caller**: no command, no tool, no approval flow, no Web surface. `grep -rln 'workspaceTrust' packages/interaction packages/client apps` returns nothing.

What stands in for it today is configuration. `workspace-trust-local`'s `Config.grants` says so in its own words — *"standing in for must[2]'s host-user interaction until an interactive upgrade exists"*. So the only way to trust a directory is to edit a YAML file and restart, which is an operator action rather than the interaction the clause names, and it produces **no audit record at all** — the grant path never goes through `requestTrustUpgrade`.

**That is the sharper half of the gap, and it was not in BLOCKED-185.** A boundary that can only be opened by editing config is one most users will open by turning the whole row off.

### 3. The two `grants` spellings are not the same rule

`Config.grants` takes a path; the service canonicalizes grants once (`canonicalGrantsOnce`) and binds each workspace to the identity it first resolved to. This matters for acceptance[1] — *"a directory replaced, symlink re-pointed, or moved does not inherit trust"* — because a grant keyed by **path** and a record bound by **identity** are two different keys for one decision. `reconcileWorkspaceTrust` is what reconciles them, and it has real callers, so the machinery is present. Whether a grant re-applies to a directory that was replaced in place is the question this slice must answer with a case rather than by reading, and I have not yet run one.

## What this makes the slice

Three candidate shapes, and they are not alternatives — (a) is a precondition of the other two being observable at all.

**(a) Give the boundary a default that can ship on.** The blocker is that `untrusted` for every directory is correct and unusable. The obvious move — grant the workspace the user explicitly launched in — needs stating carefully, because "the directory I opened" is precisely what an attacker hands you. Whether `dsh` launching in a directory is itself the host user's act of trusting it is a **ruling**, not an implementation detail, and I am not taking it.

**(b) Give must[2] its interaction.** An approval-backed upgrade would let the boundary ship on with everything untrusted, because the first project-instruction load in an untrusted workspace could ask. `packages/interaction` already owns approval, and `approval` is mounted in the base bundle. This is the piece whose absence makes (a) hard: with no way to say yes, the only safe default is the one that breaks people.

**(c) Close the fail-open** so an unmounted provider denies rather than permits. **I recommend NOT doing this**, and the reason is worth recording: with the row disabled and no interaction, denying on absence is exactly the "ships on and breaks everyone" outcome the bundle comment rejects — it would make (a)'s problem unavoidable instead of solving it. Fail-open is the right reading of an unmounted capability *while the capability has no way to be granted*. Once (b) exists, this becomes a live question again.

## Open questions — none taken here

1. **OQ21** — is launching `dsh` in a directory the host user's act of trusting it? (a) turns on the answer. A "yes" makes the boundary meaningful only against directories the agent reaches *without* being launched there; a "no" requires (b) first.
2. **OQ22** — does must[2]'s interaction belong to this epic or to whichever epic owns the approval surface? The clause is P1-07's; the surface is `packages/interaction`'s. This is the same shape as BLOCKED-198's split between a decision and its consumption point.
3. **OQ23** — the `grants` path-vs-identity question in §3 above: does a configured grant survive its directory being replaced in place? Measurable today with one case, and worth measuring **before** any of (a)–(c), because it decides whether the config route is even sound as a stand-in.

## Status

**No code written.** The census is the deliverable: this epic's decisions are reached, its default is off, and its clause-mandated interaction has no producer. The slice's shape depends on OQ21 and OQ22, which are the delegate's.

-----

# (b) The host-user interaction — shape, for review before any code

Written after OQ21/OQ22 were ruled (launching `dsh` in a directory is **not** the user's act of trusting it; the interaction belongs to P1-07 and consumes the existing approval surface). Measured at `027536c02b`. **No code written.**

## What the approval seam actually offers, and the two places it does not fit

`ctx.approval.request(req)` is mounted in the base bundle and is the right surface in the sense that matters — it is the harness's one way to put a question to a host user and have both halves audited. But it was built for tool calls, and two of its properties are not incidental:

**1. `'allowed-once'` is the only grant.** `ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`. There is no outcome meaning "yes, and remember it". A trust upgrade is by definition durable — that is the whole of must[0] and of BLOCKED-199's fix — so **the approval vocabulary cannot express the answer this question needs.** Using it as-is would mean either treating `'allowed-once'` as a durable grant (an answer the user was not asked for) or asking again every turn (a prompt the user will learn to dismiss, which is worse than not asking).

**2. The request is tool-shaped and turn-bound.** `ApprovalRequest` requires `toolName: string`, the audit pair is `approval/asked` + `approval/decided` both carrying `toolName`, and `request()` **throws outside an open turn** — deliberately, because an idle ask cannot produce the audit pair. The turn-bound half is fine: project instructions load at `agent/pre-step`, which is inside a turn. The tool-shaped half is not: there is no tool here, and putting a fake one in the audit would make the log say a tool was decided when none was.

Neither is a reason to build a second approval surface. They are reasons the shape has to be chosen deliberately, so I am not choosing it.

## The three shapes, and what each costs

**(A) Extend the approval vocabulary** with a durable grant outcome, and let `toolName` be optional or joined by a `subject` the audit can carry. Honest, and the audit then says what happened. Cost: it changes a Contract-stage surface P2-11/P2-04 consume, so it is not P1-07's alone — the same "decision here, surface there" split as BLOCKED-198 and OQ22.

**(B) Ask through approval, persist through the provider.** `'allowed-once'` is read as "the host user said yes to this directory now", and P1-07 writes the durable record itself. Cheapest, and it keeps the change inside this epic. Cost: the audit pair records a one-shot decision while the effect is permanent — **the log would understate what the user authorized**, which is the failure BLOCKED-194 just fixed in the policy layer, reintroduced here. I would rather not do this quietly.

**(C) A distinct interaction**, owned by P1-07, audited on its own events (`workspace/trust-asked` + `workspace/trust-decided`), reusing the approval answerer chain but not its tool vocabulary. Most faithful to must[2] — *"信任升级必须由宿主用户交互完成并写审计"* names an interaction and an audit, not a tool approval. Cost: a second asking path, which is exactly what "reuse the existing approval surface" was meant to avoid.

**I recommend (A) if the surface's owner will take it, else (C).** (B) is the one to avoid, for a reason this batch has already paid for once.

## Where it fires

`agent-instructions/src/files.ts:312-315` is the gate, at `agent/pre-step`. The interaction belongs immediately before it: the first time a session would load an untrusted workspace's own instruction files, ask once; until answered, the load is skipped exactly as it is skipped today.

**Not at boot**, because OQ21 ruled launching is not trusting, and because a question at boot has no turn to be audited in.

**Not through `WorkspaceRegistry.upgradeTrust`**, which the delegate already ruled, and which the measurement independently supports: `dsh-workspace` is mounted in the **web-app bundle only**, so that route does not exist on the headless profile where this boundary matters most. The interaction calls the provider.

## Non-interactive profiles

No answerer is mounted, so `request()` settles `'unavailable'` — fail closed, which is the correct direction and needs no special case. The workspace stays `untrusted` and only configured grants apply. Worth a frozen case rather than a comment, since "nobody to ask" is the state a CI agent runs in.

## What this shape does NOT settle

1. **OQ24** — which of (A)/(B)/(C), and if (A), whether the vocabulary change belongs to this epic or to the approval surface's owner.
2. **OQ25** — what the user is asked. `trusted-read` and `trusted-execute` are different answers with different consequences, and a single yes/no cannot express both. Asking twice is worse; asking once and granting the larger is the kind of default this epic exists to refuse.
3. **The audit remains blocked** on the Fiber Option A precondition recorded in BLOCKED-199, whichever shape is taken — (A) and (C) both write an audit record, and that is the write `workspace-trust/src/types.ts` says must wait.
