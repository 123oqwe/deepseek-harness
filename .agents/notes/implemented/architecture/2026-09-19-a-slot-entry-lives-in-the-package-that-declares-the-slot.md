# Agent Note: A slot entry lives in the package that declares the slot

Status: implemented

English | [中文](2026-09-19-a-slot-entry-lives-in-the-package-that-declares-the-slot.zh.md)

## Problem

`ui-session` registered the host-stop indicator into `shell.overlay`. That slot is declared by `ui-layout`, and `ui-layout` already references `ui-session` — so the registration asked for an edge that cannot exist. The key was never in `ui-session`'s program and `'shell.overlay'` did not satisfy the `SlotMap` constraint, which is where the three structural type errors came from.

The 167 other errors in the same program had one cause and it is the more instructive one. `ui-session` imported `@deepseek-ai/dsh-client-locale/client` without a matching project reference. With a reference, TypeScript reads the referenced project's declaration output; without one, `paths` resolves the specifier to that package's **source**, and the whole transitive source closure joins this project's file list. In a composite project with `rootDir: src`, every one of those files is outside the root — 82 × TS6059 and 82 × TS6307 — and, worse, their emit no longer lands in `outDir`. The build wrote `LanguageRow.js` beside `packages/client/locale/src/client/LanguageRow.tsx` and `contract/slots.d.ts` beside `ui-settings`'s source, and Vite then resolved imports to those artifacts: 54 client test files failed to collect for a reason that looks nothing like a missing tsconfig line.

Both failures were invisible locally. The type errors need `tsc -b`, which this lane does not run, and the collection failures need the test suite.

## Decision

**The entry lives in `ui-layout`, the package that declares `shell.overlay` and renders it.** Three properties had to hold at once, and only this package makes all three structural rather than circumstantial:

- It declares the slot (`src/client/index.ts`) and renders the layer (`AppFrame.tsx`), so the key needs no dependency edge at all and cannot form a cycle.
- It already reads `SessionListState` through the same `useSessions` standard hook the indicator needs: `DocumentTitle` selects the current session's title on every frame render. Reading `state.hostControl` beside it needs no new edge either, and the indicator adds no runtime requirement this package did not already have.
- A composition cannot mount `AppFrame` without it. `@deepseek-ai/dsh-client-ui-layout` appears in exactly one composition in the repository — `packages/bundle/web-app/cordis.patch.yml` — and nothing else mounts a frame. A feature package can only promise "the shipped composition happens to mount me today".

The candidates that also satisfied (a) and (b) — `ui-sidebar`, `ui-chat`, `ui-workspace`, `ui-conversation`, `ui-sidebar-right` — fail the third for that reason, and none of them is about host control.

**`locale` is a declared dependency of `ui-layout`,** so the dictionary registers in an ordinary effect. In `ui-session` it had to be a nested `ctx.inject(['locale'], …)`, because `SlotTestRuntime.create` reuses that package's `inject` array verbatim on a context with no locale service — and that nesting is what let a registration case pass vacuously until it was caught.

## The rule this generalizes

**Register into a slot from the package that declares it, or from one that already depends on that package.** The dependency direction is fixed by the declaration, so a registrant on the wrong side of it has no legal edge. The symptom is not a missing reference — it is a slot key that does not satisfy `keyof SlotMap`, and adding a reference to fix it would create a cycle.

**And every package specifier a project's source imports needs a matching project reference.** Not for tidiness: without one the referenced package's source enters this project's file list, and a composite project emits it outside its own `outDir`, into another package's source tree. A missing reference is not a type-checking inconvenience; it writes files.

## Alternatives considered

**A new `ui-host-control` package.** The honest subject for the entry, and rejected on cost and risk: a new workspace package needs a hand-written lockfile importer, and a wrong one fails CI at install — where the fix here needed three importer lines in existing blocks and two removed. `ui-layout` also gives a stronger (c) than a new package could: a new package must be mounted, `ui-layout` must be present for the frame to exist.

**Adding `ui-layout` → `ui-session` in the other direction.** Not possible; that edge already exists, which is the whole problem.

**Lowering `shell.overlay`'s declaration into `ui-slots`.** Rejected by the delegate before the work started: it changes an upstream slot's ownership to accommodate one registrant.

## Consequences

`ui-session` lost two dependency edges (`client-locale`, `client-test-runtime`) and `ui-layout` gained three test-only ones; manifests and lockfile importers moved with them. `ui-session`'s `css-modules.d.ts` went with the last `.module.css` in that package.

The two cases that asserted the registration moved too, and got stronger on the way: they now run against the real `SlotRegistry` and `LocaleRuntime` bench `ui-layout`'s own apply spec already builds, rather than a mocked `slots` object where an id and an order no renderer would accept prove nothing. `ui-session` keeps the claim its deleted pair was really about — `inject` stays the two services the shared test runtime provides.

## Related

A composition edit in the same week showed the same shape from another angle: `packages/bundle/sdk-minimal/cordis.patch.yml` gained three rows and two tests that enumerate its rows row-by-row were left expecting the previous count. One failed in CI; the other holds a byte-identical copy of the same list, read back out of a built binary, and was equally stale — it escaped only because that suite did not run that round. The census that finds the second reader is `git grep -n "sdk-minimal" -- '*/tests/*' 'scripts/*'`, and the lesson is the same as this note's: **when an artifact has more than one reader, the edit is not done until the census says which readers there are.**
