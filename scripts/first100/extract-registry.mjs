#!/usr/bin/env node
/**
 * First-100 canonical registry extractor (R0-1, reproducible).
 *
 * Produces the canonical `tests/first100/registry.json` by deterministically
 * parsing the vendored planning sources under `spec/first100/sources/`:
 *   - first100-requirements-matrix.md      (epic fields: files, must, acceptance, non-goal, validation, command, real-task)
 *   - implementation-wave-map.md           (wave, predecessors, C/P/U/F stages with file lists, gate, rollback)
 *   - r0-decision-package.md               (§2 full primaryLayer mapping + source-certified ambiguous ids)
 *
 * The registry is the single canonical machine-readable source of truth for all
 * 100 First-100 epics. spec/ artifacts are generated from it (R0-2).
 *
 * CLI:
 *   node scripts/first100/extract-registry.mjs                     write tests/first100/registry.json
 *   node scripts/first100/extract-registry.mjs --check             regenerate in memory; byte-compare; exit 0/1
 *   --sources <dir>   source dir (default spec/first100/sources)
 *   --out <path>      output path (default tests/first100/registry.json)
 *
 * The committed registry is byte-identical to a fresh extraction from the
 * pinned vendored sources (proven by scripts/first100/registry-regenerate.spec.ts),
 * so manual dual-maintenance is impossible.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseMatrixText } from './matrix-parse.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(here, '..', '..')

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const arg = (flag, fallback) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
const SOURCES_DIR = arg('--sources', join(REPO_ROOT, 'spec/first100/sources'))
const OUT_PATH = arg('--out', join(REPO_ROOT, 'tests/first100/registry.json'))
const CHECK = argv.includes('--check')

// ---------------------------------------------------------------------------
// 1. Read planning sources
// ---------------------------------------------------------------------------
const matrixText = readFileSync(join(SOURCES_DIR, 'first100-requirements-matrix.md'), 'utf8')
const waveMapText = readFileSync(join(SOURCES_DIR, 'implementation-wave-map.md'), 'utf8')
const decisionText = readFileSync(join(SOURCES_DIR, 'r0-decision-package.md'), 'utf8')

const MATRIX_SHA = 'c8dc62fa7d5e37ae303ecbe6045dfee3781b519ba116d1d0b05f221133f31b63'
const WAVEMAP_SHA = '8c84597f87289fe5dfbf675dcba072149c6678cecc81a2611329b42de6c56d41'
const actualMatrixSha = sha256(matrixText)
const actualWaveSha = sha256(waveMapText)
if (actualMatrixSha !== MATRIX_SHA) throw new Error(`matrix sha mismatch: ${actualMatrixSha}`)
if (actualWaveSha !== WAVEMAP_SHA) throw new Error(`wave-map sha mismatch: ${actualWaveSha}`)

/**
 * BLOCKED-037: registry epics whose provenance is `BASE-ALIGN-v2 new-gap` --
 * never derivable from the 3 canonical pinned docs above, because they
 * describe capability gaps upstream itself introduced after those docs were
 * written. The filenames and their SHAs are hardcoded here (never read from
 * `registry.json`'s own `sourcePins`, which is an OUTPUT record, not an
 * input -- letting registry data steer what the extractor consumes would
 * reopen exactly the injection BLOCKED-035 exists to close, one level up).
 * Adding a future new-gap source (e.g. a P9-class one) means adding an
 * entry to this array plus its own SHA constant -- a real, reviewed code
 * change, never a registry.json edit alone. Each is fail-closed SHA-verified
 * the same way as the 3 canonical docs; a missing/mismatched file blocks
 * extraction entirely, exactly like a canonical doc mismatch would.
 */
const NEWGAP_MATRIX_SHA = '43d6c2a8b68675c7b42132f40a3a7739a8fad76623c5e05203b5d2ccb42fcb88'
const NEWGAP_WAVEMAP_SHA = 'e309e6a4c9bf17c5bcd5565348b3664df428956ed8bf6e6f7878b8aab2e9fc5e'
const NEWGAP_SOURCES = [
  { matrix: 'base-align-v2/new-gap-matrix.md', matrixSha: NEWGAP_MATRIX_SHA, waveMap: 'base-align-v2/new-gap-wavemap.md', waveMapSha: NEWGAP_WAVEMAP_SHA },
]

/**
 * BLOCKED-043: vendored sources this extractor cites but never parses.
 *
 * `upstream-status-COMPLETE.md` carries the P9-01..09 upstream-coverage
 * verdict, and it is the sole evidence for the program's terminal-state
 * requirement that all nine P9 items be VERIFIED or scheduled-BLOCKED. It is
 * referenced below only as a `rationaleDoc` string, so before this pin nothing
 * verified it: appending a fabricated verdict left extraction at exit 0, while
 * the same append to the SHA-pinned `new-gap-matrix.md` beside it failed
 * closed. A record that decides a terminal-state answer must not be editable
 * without any gate reporting it.
 *
 * Kept out of `NEWGAP_SOURCES` deliberately: entries there are PARSED into
 * epic rows, and this document has no matrix or wave-map structure. It is
 * verified and never read for content, which is why it needs its own list.
 */
const CITED_SOURCE_SHAS = [
  {
    path: 'base-align-v2/upstream-status-COMPLETE.md',
    sha256: '2858c273340502af8819d8493cad6cc8854b63e19914d0b5dd38e4f42465f57c',
  },
]
for (const cited of CITED_SOURCE_SHAS) {
  const actual = sha256(readFileSync(join(SOURCES_DIR, cited.path), 'utf8'))
  if (actual !== cited.sha256) {
    throw new Error(
      `${cited.path}: sha mismatch (got ${actual}, expected ${cited.sha256}) -- cited-but-unparsed sources are fail-closed SHA-pinned exactly like the parsed ones`,
    )
  }
}

/**
 * BASE-ALIGN-v2 23-PARTIAL rescope (spec/first100/sources/base-align-v2/23-partial-rescope-spec.md,
 * delegate-approved mechanism, 2026-09-02): these canonical epics' `must`
 * text was narrowed in-place in first100-requirements-matrix.md to only the
 * delta not yet covered by upstream 4e84901e -- the registry stays the sole
 * source of truth (edit the pinned source + re-extract, never a second
 * overlay). `RESCOPE23_PRIOR_MATRIX_SHA` is the matrix doc's sha256 BEFORE
 * this rescope, preserved so "what did the canonical spec say before
 * BASE-ALIGN-v2" is answerable from the registry itself without git
 * archaeology. Grows as epics are rescoped; membership here is what has
 * ACTUALLY been edited, not the full 23-item authorization ceiling.
 */
/**
 * Every clause-provenance entry one epic carries, from movements and splits alike.
 *
 * Both end up in the same registry field because a reader asking "where did
 * this clause come from" wants one answer, not two lists to join. They stay
 * separate constants because the two operations differ in what the coverage
 * report can check: a movement matches verbatim, a split cannot.
 * @param id - the epic to collect for.
 * @returns its provenance entries, movements first.
 */
function clauseProvenanceFor(id) {
  const entries = [...(CLAUSE_MOVEMENTS[id] ?? []), ...(CLAUSE_REWORDS[id] ?? [])]
  for (const split of CLAUSE_SPLITS) {
    for (const part of split.parts) {
      if (part.epic !== id) continue
      entries.push({
        clause: part.clause,
        splitFrom: split.source,
        sourceClause: split.sourceClause,
        siblingClauses: split.parts.filter(other => other !== part).map(other => `${other.epic}: ${other.clause}`),
        splitAtUtc: split.splitAtUtc,
        basis: split.basis,
        reason: split.reason,
      })
    }
  }
  return entries
}

const RESCOPE23_PRIOR_MATRIX_SHA = '401a3c63b7639b2df0f6ef81349df28667313deaa2d4f8e777d8f7eb531ce4fa'
// Only epics whose `must` text was ACTUALLY narrowed belong here -- of the
// 23 authorized-for-review epics, 13 were independently re-reviewed against
// this same evidence and left untouched (a compound MUST clause where the
// covered portion isn't cleanly separable, or judgment language hedged as
// "largely"/"partially" rather than an unhedged "met", falls below the
// BLOCKED-012 bar for removal); P5-10 is authorized-for-review but its own
// change here is a files[] baseline-drift correction (control.ts N->B, a
// different fix class), not a must-narrowing, so it is not listed either.
const RESCOPE23_EPIC_IDS = ['P3-03', 'P3-07', 'P4-05', 'P4-10', 'P5-07', 'P5-11', 'P6-05', 'P6-06', 'P6-07', 'P6-10']

/**
 * Clauses moved between epics in first100-requirements-matrix.md, keyed by the
 * epic that carries each one now.
 *
 * Same discipline as the rescope above: the pinned doc is edited and
 * re-extracted, never overlaid. What the doc edit cannot hold is WHERE the
 * clause came from -- after the edit the matrix reads as if P4-12 always had it
 * -- so the origin, the date, the basis and the reason live here and reach the
 * registry as the destination epic's `clauseProvenance`. The clause-coverage
 * report reads that field to match the clause against the v1.0 YAML span filed
 * under its former owner, which is why moving a clause does not read as one
 * epic dropping a source clause and another inventing one.
 *
 * Every entry is checked against the extracted MUST text below: a record whose
 * clause the matrix does not actually give that epic fails the extraction.
 */

/**
 * `files[]` reductions and hot-zone relocations from the 2026-09-06
 * rectification order (spec/first100/exec/plan-rectification-2026-09-06.md).
 *
 * Neither touches a clause, which is why neither appears in `clauseProvenance`
 * and neither reaches the coverage report: what an epic must DO is unchanged,
 * and only where it may write has moved.
 *
 * **A reduction** drops a declared new file whose feature the pinned dependency
 * already ships — the epic still owes the behaviour, it just no longer owes a
 * file to put it in. **A relocation** drops an upstream-hot `[B]` file so the
 * capability arrives as a new rung, plugin or contribution instead. P5-10 is the
 * worked example: its convergence barrier took participants through
 * `addParticipant` rather than editing the subagent hot path, and its four cells
 * are green.
 *
 * Recorded here rather than inferred from the diff, because "this file is gone
 * because upstream ships it" and "this file is gone because we stopped editing
 * a hot path" are different decisions with different reversals.
 */
const FILES_REDUCED = {
  'P5-07': { removed: ['subagent-codex/src/map-events.ts', 'subagent-codex/src/continuation.ts'], reason: '@openai/codex 0.149.1 already ships thread/resume, thread/fork, turn/steer, turn/interrupt, thread/list and item requestApproval.' },
  'P5-08': { removed: ['subagent-claude-code/src/map-events.ts', 'subagent-claude-code/src/continuation.ts'], reason: '@anthropic-ai/claude-agent-sdk 0.3.241 already ships resume/continue, forkSession, canUseTool and hooks.' },
  'P5-03': { removed: ['llm/prompt-compiler/src/compile.ts'], reason: 'Per-provider compilation already exists as pi-ai compat flags plus llm-pi-ai toPiContext and llm-deepseek translate.' },
  'P4-14': { removed: ['run/turn-checkpoint/src/index.ts', 'run/turn-checkpoint/src/types.ts'], reason: 'Redundant with upstream session events and repair.ts; what remains is a resume classifier over the signals those already produce.' },
  'P7-07': { removed: ['observability/otel-exporter/src/index.ts'], reason: 'packages/session/session-telemetry-otel IS the OTel backend; a TracerProvider pipeline belongs there, not in a second exporter package.' },
  'P2-10': { removed: ['policy/policy-language/src/parser.ts', 'policy/policy-language/src/compiler.ts'], reason: 'A homemade policy language. The engine is Cedar; explain is its isAuthorized diagnostics and dry-run its isAuthorizedPartial residuals.' },
}
/**
 * Files ADDED to an epic because a repository-wide convention forces them,
 * not because the epic's own clauses ask for them.
 *
 * The mirror image of {@link FILES_REDUCED}: that records a file the plan
 * named and the tree does not need; this records a file the tree needs and
 * the plan did not name. Both are edits to a pinned file list, so both are
 * recorded rather than left to be inferred from a diff.
 *
 * `B4(f)` admits such a file into its stage's slice without counting against
 * the stage's size limit, because the epic did not choose to write it. The
 * limit exists to bound the work an epic takes on; scaffolding the repository
 * demands of every package is not that.
 *
 * Each entry names the CONVENTION that forces the file, so a later reader can
 * check whether it still holds. If the convention goes, the file's admission
 * goes with it.
 */
/**
 * Test files ADDED to an epic because its unlock signal names an observation
 * none of its declared files could make.
 *
 * Distinct from {@link SCAFFOLD_FILES}, and the difference decides who pays.
 * A scaffold file is forced by a repository-wide convention the epic did not
 * choose, so B4(f) admits it without counting against the stage. A test file
 * is the epic's OWN work: it is added here because the registry's file list
 * was wrong about what proving the clause requires, not because a convention
 * demands it.
 *
 * Recorded rather than written silently, because a lock whose unlock signal
 * cannot be observed by any declared file is a defect in the file list, and
 * the next reader needs to see that it was found and decided rather than
 * quietly patched.
 */
/**
 * Files REPLACED in an epic's list, because the declared path cannot hold what
 * the clause needs.
 *
 * Distinct from a reduction (the file is unnecessary) and from an addition
 * (the list was short): here the registry named a real file that is the wrong
 * KIND of file, so the work has to land somewhere else. Recorded with the
 * mechanical reason, because "we put it elsewhere" and "the declared place
 * could not hold it" are different claims and only the second justifies
 * editing a pinned list.
 */
/**
 * Apply an epic's recorded file replacements to its epic-level list.
 * @param id - the epic id.
 * @param files - the list parsed from the pinned matrix, plus any additions.
 * @returns the list with each replacement applied in place.
 */
function applyFileReplacements(id, files) {
  const replacements = FILES_REPLACED[id]?.replacements ?? []
  if (replacements.length === 0) return files
  return files.map((file) => {
    const replacement = replacements.find(entry => entry.from === file.path)
    return replacement === undefined ? file : { path: replacement.to, kind: replacement.kind }
  })
}

const FILES_REPLACED = {
  'P5-11': {
    replacements: [
      { from: 'packages/collaboration/mailbox/src/index.ts', to: 'packages/run/message-bus/src/mailbox-delivery.ts', kind: 'N', stage: 'U' },
    ],
    reason: "`@deepseek-ai/dsh-mailbox` was retired into `@deepseek-ai/dsh-message-bus`, and the declared path named the package that no longer exists. What the mailbox held beyond `dsh-intake-dedup`'s rule was a recipient-address check and a set of type names -- a package for a seam that does not exist, and the split had already produced one rule with two implementations, the copy P4-06's clause was about being the one nothing called (BLOCKED-136). The address check is now `decideMailboxArrival` in the bus, beside the store-backed `decideMailboxDelivery` that was already P4-06's production call site, and P5-11's mailbox clause is satisfied there rather than in a package of its own.",
    consequence: 'The published `@deepseek-ai/dsh-mailbox` package is gone; an installed consumer importing it breaks, and nothing in this repository does. Pre-release stance: no shim.',
    authorization: 'delegate ruling, 2026-09-08, §12.27-2 (BLOCKED-154).',
  },
  'P4-08': {
    replacements: [
      { from: 'packages/workflow/workflow-journal/src/index.ts', to: 'packages/collaboration/workflow-journal/src/index.ts', kind: 'N', stage: 'P' },
      { from: 'packages/workflow/workflow-journal/src/types.ts', to: 'packages/collaboration/workflow-journal/src/types.ts', kind: 'N', stage: 'C' },
      { from: 'packages/workflow/workflow-journal/src/replay.ts', to: 'packages/collaboration/workflow-journal/src/replay.ts', kind: 'N', stage: 'C' },
      { from: 'packages/workflow/workflow-journal/tests/resume.e2e.ts', to: 'packages/collaboration/workflow-journal/tests/resume.e2e.ts', kind: 'N', stage: 'C' },
      { from: 'packages/workflow/workflow-journal/src/replay.ts', to: 'packages/collaboration/workflow-journal/src/replay.ts', kind: 'N', stage: 'F' },
      { from: 'packages/workflow/workflow-journal/tests/resume.e2e.ts', to: 'packages/collaboration/workflow-journal/tests/resume.e2e.ts', kind: 'N', stage: 'F' },
    ],
    reason: "The package moved from `packages/workflow/` to `packages/collaboration/`, and the declared paths named the old directory. Mechanical cause: `check-layer-deps` maps the whole `workflow` group to `orchestration-runtime` while `dsh-workflow-worker-thread` is classified `providers`, so the engine importing the journal registered as a `providers -> orchestration-runtime` edge the moment P4-08's Usage wired them together (findings 120 -> 121, BLOCKED-149). The journal computes nothing at run time and mounts nothing -- a record shape plus four pure decisions over caller-supplied values -- so it belongs in a capability-definitions group by the same argument that moved the lease contract under §12.16, and `collaboration` is where that contract went.",
    consequence: 'The published package directory changes, so an installed consumer resolving it by path rather than by package name breaks; nothing in this repository does.',
    authorization: 'delegate ruling, 2026-09-07, §12.22-1 (BLOCKED-149).',
  },
  'P1-03': {
    replacements: [{
      from: 'packages/bundle/base/cordis.patch.yml',
      to: 'packages/bundle/base/package.json',
      kind: 'B',
      stage: 'U',
      reason: "must[2]'s call site reads `unlockedProfilePolicy` per bundle, and `cordis.patch.yml` cannot declare it: that file is a YAML LIST of patch operations (its top level is `- insert:`), validated as an entry list, and vendored modification 8 makes a non-array parse invalid. A top-level scalar key there fails Include validation outright. `ProfileLayer` exposes only `{packageName, packageDir, patchPath, patches}`, so the layer carries no other channel either. The key lands at `dsh.pluginLock.unlockedProfilePolicy` in the bundle's package.json -- the same per-bundle, boot-time metadata `readPluginDeclaration(layer.packageDir)` already reads for pre-mount admission, and boot precedes the Cordis context so no plugin Config instance exists to read instead.",
      consequence: 'The key becomes part of a shipped bundle\'s published package.json, so later changes to it are a release-surface change rather than internal configuration.',
    }],
    authorization: 'delegate ruling, 2026-09-06, §10.3-1 (g) as revised (BLOCKED-133 follow-up).',
  },
}

const TEST_FILES_ADDED = {
  'P1-03': {
    added: [{ path: 'apps/cli/tests/plugin-lock.spec.ts', kind: 'N', stage: 'U' }],
    reason: "P1-03's lock unlocks on a case proving that a profile whose lock was written by `dsh plugin` is refused at boot when a digest drifts. must[1] already produces such a lock (`apps/cli/src/plugin.ts` calls `commitProfileLock` on every successful pnpm run), but NOTHING tests it -- `commitProfileLock` and `plugins.lock.json` appear zero times under `apps/cli/tests/`. The epic's only declared test file is `plugin-lock/tests/lock.spec.ts`, a unit spec for the library, and its U stage declared no test file at all. The unlock signal therefore named an outcome no declared file could observe (BLOCKED-133).",
    authorization: 'delegate ruling, 2026-09-06 (BLOCKED-133): keep the signal end-to-end and add the file, rather than restate the signal against what a unit spec can reach.',
    filenameDeviation: "The ruling named `apps/cli/tests/profiles/plugin-lock.e2e.ts`; the file is `apps/cli/tests/plugin-lock.spec.ts` instead, and the reason is mechanical rather than preference. `vitest.config.ts`'s `testIncludes` collects only `*.spec.ts`; `*.e2e.ts` runs solely under `vitest.e2e.config.ts` via `pnpm run test:e2e`, which is a separate run and, per docs/testing.md, the real-API lane. The greening observation IS `pnpm run test`'s JSON report, so a frozen title living in an `.e2e.ts` file could never be found in any observation and the cell could never green. This test needs no API key -- only a temporary profile directory -- so it is not a real-API test in the first place.",
  },
}

/**
 * CONSUMER files added to an epic's list, because the plan named no consumer
 * its Usage stage could reach.
 *
 * Distinct from {@link TEST_FILES_ADDED} and the difference is who the addition
 * is about. A test file is the epic's own work, added because the list was
 * wrong about what PROVING a clause requires. A consumer is the thing the
 * clause is about being USED by — added because the list was wrong about where
 * the capability lands, which gate (u) reports as a Usage stage that never
 * reaches anything.
 *
 * Every entry carries the ruling that authorized it. An executor deciding for
 * itself which consumer an epic should have is the executor choosing the
 * stage's scope, which §12.11 records as the mistake this table exists to make
 * visible rather than silent.
 */
const CONSUMERS_ADDED = {
  'P5-10': {
    added: [{ path: 'packages/subagent/subagent/src/index.ts', kind: 'B', stage: 'U' }],
    reason: "must[1]'s `orderByPriority` and must[2]'s durable/epoch/idempotent control state both belong at the surface that actually receives control operations, and `subagent/src/index.ts` is it: the prompt path decides `continue` there and the interrupt path sets `cancelling` there. The row named `child-agent.ts`, `lifecycle.ts` and `core/agent/src/inbox.ts` and omitted the file where control is admitted, which is why the Usage stage could touch its declared consumers and still leave `ChildControlRouter` unmounted (BLOCKED-153).",
    authorization: 'delegate ruling, 2026-09-07, §12.24-2.',
  },
  'P6-02': {
    added: [
      { path: 'packages/memory/memory/src/index.ts', kind: 'N', stage: 'U' },
      { path: 'packages/context/memory-context/src/index.ts', kind: 'N', stage: 'U' },
    ],
    reason: "P6-02's Usage stage declared two `types.ts` files and NO consumer at all, so gate (u) reported it as an epic whose row names no baseline consumer -- a planning defect stacked on the usage one (BLOCKED-146: all seven clause subjects had zero production callers). The two added files are the write path (`dsh-memory`'s runtime, already mounted in the base bundle) and the read path (`dsh-memory-context`, P6-01's recall), which are where a record is validated, conflicts recorded and retrieval filtered.",
    authorization: 'delegate ruling, 2026-09-07, §12.19-1, kind corrected 2026-09-08.',
    kindCorrection: "Both were first recorded `kind: B`, and `B` has a definition these files do not meet: present in the frozen baseline 4e84901e. `dsh-memory`'s runtime is P6-02's own [N] and `dsh-memory-context` is P6-01's, so `verify-baseline-file-references` refused them fail-closed and was right to. The label was carrying a meaning it does not have -- `B` was being used to say `consumer`. They are `N`, and gate (u) reads this table directly through the row's `usageConsumers` rather than inferring a consumer from a baseline kind, so the ruling's substance is unchanged.",
  },
}

const SCAFFOLD_FILES = {
  'P2-04': {
    added: [{ path: 'packages/policy/risk-taxonomy/src/index.ts', stage: 'C' }],
    convention: "tsdown.config.ts builds `workspace: ['vendor/*', 'packages/*/*', 'apps/cli']` against the fixed entry glob `lib/types/{index,invariant,startup}.js` with no per-package exclusion, so a package directory without an `index.ts` fails `pnpm run typecheck` the moment it exists. Measured: while it was absent, risk-taxonomy was the only packages/*/* in the repository without one.",
    reason: 'The registry declares src/index.ts at epic level but assigns it to P while the rest of the package is C, which cannot be built in that order (BLOCKED-131). This adds STAGE membership only -- the path was always declared. Admitted to C as a type-only barrel -- exactly one statement, `export type * from ./types.ts` -- so the Contract stage stays a contract: nothing re-exported can execute, and the runtime exports remain the Provider stage deliverable. Pinned by the frozen case "src/index.ts is exactly one statement and it re-exports types only", because the cheapest way to fix a later missing export is to add a runtime one here.',
    authorization: 'delegate ruling, 2026-09-06 (BLOCKED-131), citing B4(f)',
  },
  'P4-02': {
    added: [{ path: 'packages/run/task-profile/src/index.ts', stage: 'C' }],
    convention: "The same tsdown entry glob P2-04 measured, measured again here: with src/index.ts absent, `pnpm run typecheck` fails at `[@deepseek-ai/dsh-task-profile] Cannot find entry: [\"lib/types/{index,invariant,startup}.js\"]` -- tsdown resolves that fixed glob for every workspace package with no per-package exclusion, so a package directory without an index.ts cannot be built the moment it exists.",
    reason: "The registry declares src/index.ts at epic level but assigns it to P while types.ts, validate.ts and the tests are C, which cannot be built in that order. This adds STAGE membership only -- the path was always declared. Admitted to C as a type-only barrel, exactly one statement, so the Contract stage stays a contract: the deterministic compiler must arrive as a runtime export in P rather than slip in as a convenience re-export now.",
    authorization: "delegate ruling gq-92, 2026-09-10, B4(f), same shape as P2-04/BLOCKED-131: the C-stage index.ts carries only `export type * from './types.ts'` because tsdown's fixed entry glob requires the file to exist; runtime exports land in P",
  },
}

const HOT_ZONE_RELOCATED = {
  'P3-01': { removed: ['core/agent-loop/src/runtime-context.ts'], reason: 'The world handle arrives through sandbox-policy\'s runtime-context snapshot contribution; the loop is unchanged.' },
  'P3-05': { removed: ['sandbox/sandbox-local/src/index.ts', 'sandbox/sandbox-local/src/profiles.ts'], reason: 'A new sandbox-srt rung over @anthropic-ai/sandbox-runtime carries the per-platform mapping. THIS LEAVES P3-05 WITH NO [B] FILE AT ALL, which is intended and is CONDITIONAL: sandbox-local today selects its runner from a hardcoded table (`PLATFORM_CHAINS` at src/index.ts:159, `linux: [bwrap, landlock]`), so there is no contribution point to mount a rung on. Converting that table into one is the §3.2 sandbox-srt slice\'s own deliverable, landing before W7 while P3-05 is W9. If §3.2 finds the table cannot become a contribution point -- runner selection may have a reason it cannot move -- P3-05 takes back one [B] line then, as that slice\'s finding rather than as a guess made here.' },
  'P3-07': { removed: ['sandbox/sandbox-local/src/index.ts', 'sandbox/sandbox-local/src/profiles.ts'], reason: 'Same rung and the same §3.2 precondition as P3-05 (W10, so the ordering holds). Its own additions -- the attestation predicate schema and the requested-subset-of-supported check -- are new files inside sandbox-local, which adds to the package without editing its hot path.' },
  'P5-05': { removed: ['subagent/src/descriptor.ts', 'subagent/src/descriptor-seed.ts', 'subagent/src/depth.ts', 'subagent/src/client.ts'], reason: 'Five hot files down to one. New request fields land in [N] request.ts as capability flags; types.ts stays only as the re-export point.' },
  'P5-06': { removed: ['subagent/src/assistant-output.ts', 'subagent/src/lifecycle.ts'], reason: 'Result contract extensions land in [N] result.ts; types.ts stays as the re-export point.' },
}

/**
 * Clauses REWORDED against the pinned source, because the plan was wrong about
 * reality.
 *
 * The third and most consequential provenance kind. A MOVEMENT keeps a clause
 * verbatim under a new owner; a SPLIT divides a compound clause between owners;
 * both still trace every word to the pinned document. A REWORD does not. Its
 * text appears in no source, and it says the source was mistaken.
 *
 * That distinction is not bookkeeping. Until 2026-09-06 every registry clause
 * traced verbatim to a pinned document, and the coverage report's whole meaning
 * rested on it. A reword breaks that for the first time, so it is counted and
 * reported as its own category rather than dressed as sourced -- ruled by the
 * user directly on 2026-09-06, who declined to let corrections hide inside the
 * matched count.
 *
 * Each entry names the EVIDENCE, not just the intent: a plan correction with no
 * observation behind it is an opinion overwriting a pinned document.
 */
const CLAUSE_REWORDS = {
  'P2-03': [
    {
      clause: 'canonicalizer 遵循 RFC 8785（JCS）——key 顺序、数字拼写、JSON 转义拼写不同的同一 JSON 值得到相同 hash，而不同 code point 序列（含 NFC 与 NFD）是不同值必须得到不同 hash，fuzz 覆盖以上四类。',
      rewordedFrom: 'fuzz canonicalizer，禁止 key order/Unicode/number 表示导致 hash 混淆。',
      channel: 'validation',
      rewordedAtUtc: '2026-09-06T14:00:00.000Z',
      basis: 'Rectification order §7.4 item 4 and §7.8, delegate ruling of 2026-09-06 under the C11 delegation.',
      evidence: 'The old wording put Unicode normalization form in the same list as key order and number spelling, as though all three were spellings of one value. RFC 8785 does not normalize: two code point sequences are two values. The implementation followed the clause and normalized to NFC, which meant a precomposed and a decomposed spelling of the same character produced one argumentsHash -- and P2-06 binds approvals to that hash, so on a filesystem where those name two files, approving one action authorised the other. The clause named hash confusion and the code committed it, in the direction the clause had not considered. Verified against the reference implementation: canonicalize@2.1.0 distinguishes the two forms and collapses the other three.',
    },
  ],
  'P4-06': [
    {
      clause: 'domain event 与 outbox 行在同一 SQLite 事务（BEGIN IMMEDIATE）内写入，不经 storage KV seam',
      rewordedFrom: '事务性写入 domain event 与 outbox',
      channel: 'must',
      rewordedAtUtc: '2026-09-06T12:00:00.000Z',
      basis: 'Rectification order §A (spec/first100/exec/plan-rectification-2026-09-06.md), delegate ruling of 2026-09-06, executed under the C11 delegation with the user\'s direct answer on the reword category.',
      evidence: 'Independently verified in the tree: `commitWithOutbox` (packages/run/message-bus/src/index.ts) calls `sink.enqueueAll([event, ...records])` -- one BATCH, not one transaction. BLOCKED-089 already recorded that recovery truncates to the last COMPLETE record rather than a batch boundary, so a mid-batch crash can keep the domain event and drop its outbox row. `BEGIN IMMEDIATE` exists in this repository (session-query-sqlite) but not on this path, which is what the new wording names.',
    },
    {
      clause: '在 commit 前后、发送前后、ack 前后 kill，消息最终只产生一次业务 effect，由 consumer 按 (source, messageId, epoch) 幂等保证，不由传输保证 exactly-once。',
      rewordedFrom: '在 commit 前后、发送前后、ack 前后 kill，消息最终只产生一次业务 effect。',
      intermediateWording: '在 commit 前后、发送前后、ack 前后 kill，消息最终只产生一次业务 effect，由 consumer 按 (messageId, epoch) 幂等保证，不由传输保证 exactly-once。',
      channel: 'acceptance',
      rewordedAtUtc: '2026-09-07T09:30:00.000Z',
      basis: 'Rectification order §A (2026-09-06) named the consumer as the guarantor; §12.9 (2026-09-07) corrected WHAT the consumer keys on. One entry rather than two because a provenance record whose clause is not in the matrix fails extraction, and the intermediate wording is preserved here instead of in a dangling second record.',
      evidence: 'Two changes to one clause. §A: the outcome is unchanged -- one business effect -- and what changed is WHO guarantees it, since the transport cannot and must[2] already put the duty on the consumer. §12.9: The standard this epic OWNS answers the question the clause got wrong. CloudEvents defines uniqueness as `source` + `id`; the clause said `(message id, epoch)` and the implementation matched the clause exactly, so no test could catch it. Measured on the shipped `classifyDedup` before the reword: `{source:\'/dsh/sender-a\',id:\'evt-1\',epoch:1}` and the same id and epoch from `/dsh/sender-b` both produced the key `5:evt-1:1`, and the second returned `{action:\'drop\',reason:\'duplicate\'}` -- one sender\'s message silently suppressed by another\'s. `MessageId` claims uniqueness \'for the life of the program\' in its own JSDoc, but no production code mints an id (measured: zero producers under `src`), so a consumer cannot verify that claim and must not rest on it. The data was already on both paths -- `source` is `TEXT NOT NULL` on the bus and the mailbox carries `from` -- it simply was not in the key. A TIGHTENING: within one source the previous guarantee is unchanged, and messages that were wrongly conflated are now kept apart.',
    },
    {
      clause: 'consumer 按 (source, message id, epoch) 去重。',
      rewordedFrom: 'consumer 按 message id/epoch 去重。',
      channel: 'must',
      rewordedAtUtc: '2026-09-07T09:30:00.000Z',
      basis: 'Rectification order §12.9 (spec/first100/exec/plan-rectification-2026-09-06.md), delegate ruling of 2026-09-07 under the C11 delegation. A-class: the delegate rules the change, the executor edits the pinned source and re-extracts.',
      evidence: "The standard this epic OWNS answers the question the clause got wrong. CloudEvents defines uniqueness as `source` + `id`; the clause said `(message id, epoch)` and the implementation matched the clause exactly, so no test could catch it. Measured on the shipped `classifyDedup` before the reword: `{source:'/dsh/sender-a',id:'evt-1',epoch:1}` and the same id and epoch from `/dsh/sender-b` both produced the key `5:evt-1:1`, and the second returned `{action:'drop',reason:'duplicate'}` -- one sender's message silently suppressed by another's. `MessageId` claims uniqueness 'for the life of the program' in its own JSDoc, but no production code mints an id (measured: zero producers under `src`), so a consumer cannot verify that claim and must not rest on it. The data was already on both paths -- `source` is `TEXT NOT NULL` on the bus and the mailbox carries `from` -- it simply was not in the key. A TIGHTENING: within one source the previous guarantee is unchanged, and messages that were wrongly conflated are now kept apart.",
    },
  ],
}

/**
 * Compound source clauses split between the epics that own each mechanism.
 *
 * A SPLIT is not a MOVEMENT. `CLAUSE_MOVEMENTS` above relocates a clause whose
 * wording survives intact, so the coverage report can match it verbatim against
 * the pinned YAML under its former owner. A split has no verbatim survivor: the
 * source clause named two mechanisms in one sentence, and each half is reworded
 * as its own clause under the epic that owns it. Forcing that through the
 * movement mechanism would silently produce one unmatched source clause and two
 * invented ones, which is exactly the reading a split must not produce.
 *
 * **The invariant a split must not break is losslessness.** Every part is
 * declared here, and extraction fails if any declared part is missing from its
 * epic's MUST text or if a part names an epic that has no such clause — so a
 * split cannot quietly drop half of what the source said. What no check can
 * decide is whether the parts MEAN what the whole meant; that is the reviewing
 * judgement the ruling records, not something this file can assert.
 */
const CLAUSE_SPLITS = [
  {
    source: 'P2-03 must[2]',
    sourceClause: 'code-mode 内嵌工具和插件 RPC 不能绕过。',
    splitAtUtc: '2026-09-06T09:00:00.000Z',
    basis: 'Delegate ruling of 2026-09-06, executed under the C11 delegation re-confirmed with the user immediately before this edit.',
    reason: 'The clause named two mechanisms in one sentence and P2-03 owns only one of them. The plugin-RPC half has no subject anywhere in the repository: the out-of-process plugin host that would create a dispatch point is P1-06\'s own must[0], four waves later. Leaving both halves on P2-03 made a wave-4 epic unacceptable until a wave-8 epic landed, with P2-04, P2-05 and P4-02 queued behind it — a scheduling inversion in the registry rather than a real dependency.',
    parts: [
      { epic: 'P2-03', clause: 'code-mode 内嵌工具不能绕过。' },
      { epic: 'P1-06', clause: '插件 RPC 不能绕过 ActionManifest。' },
    ],
  },
]

const CLAUSE_MOVEMENTS = {
  'P4-12': [
    {
      clause: '外部 idempotency ledger 拒绝 stale epoch。',
      movedFrom: 'P4-07 must[3]',
      movedAtUtc: '2026-09-06T02:00:00.000Z',
      basis: 'BLOCKED-100 third pre-flight question plus the delegate ruling of 2026-09-06, executed under the user\'s explicit delegation confirmed directly before any registry edit.',
      reason: 'The clause names an external idempotency ledger that rejects a stale epoch. P4-07 (Worker Lease, Heartbeat and Fencing Token) mints the epoch and has no consumer for it, so satisfying the clause there would mean building the ledger P4-12 is titled after. The mechanism belongs to its owner; the wording is unchanged.',
    },
  ],
}
/** The matrix doc's sha256 BEFORE the clause movements above were applied. */
const PRE_CLAUSE_MOVEMENT_MATRIX_SHA = 'c35e0530c943cb8357bf7aadc97cd2399bbdaa1499cb4e609d8876cd9e25d4b0'

/**
 * Unconditional since P3-13 landed (2026-09-03): its new-gap-matrix.md/
 * new-gap-wavemap.md drafts passed Tier-S panel review and are SHA-pinned
 * above, and registry.json now carries it as the 101st epic. The prior
 * `--include-new-gap` CLI flag was transitional scaffolding only (so the
 * mechanism could be built and bidirectionally verified before landing
 * without changing the committed registry byte); it is intentionally not
 * read from argv anymore -- a flag someone has to remember to pass on
 * every future `--check`/regeneration is exactly the "invariant held by
 * an agent's own diligence" shape BLOCKED-034 exists to flag.
 */
const INCLUDE_NEW_GAP = true

// ---------------------------------------------------------------------------
// 2. Parse the matrix
// ---------------------------------------------------------------------------
const ID_RX = /\bP([0-8])-(\d{2})\b/

const matrix = parseMatrixText(matrixText)
if (matrix.size !== 100) throw new Error(`matrix: expected 100 epic sections, got ${matrix.size}`)

const newGapMatrix = new Map()
const newGapWaveMap = new Map()
if (INCLUDE_NEW_GAP) {
  for (const src of NEWGAP_SOURCES) {
    const mText = readFileSync(join(SOURCES_DIR, src.matrix), 'utf8')
    const actualSha = sha256(mText)
    if (actualSha !== src.matrixSha) throw new Error(`${src.matrix}: sha mismatch (got ${actualSha}, expected ${src.matrixSha}) -- new-gap sources are fail-closed SHA-pinned exactly like the 3 canonical docs`)
    for (const [id, entry] of parseMatrixText(mText)) newGapMatrix.set(id, entry)
  }
}

const parseFiles = (s) => {
  const out = []
  const rx = /`([^`]+)`\s*\[([BNP])\]/g
  let m
  while ((m = rx.exec(s))) out.push({ path: m[1], kind: m[2] })
  return out
}
const splitClauses = (s) => s.split('；').map((c) => c.trim()).filter((c) => c.length > 0)
const parsePriorityWave = (s) => {
  const p = s.match(/^(P[0-8])\s*\/\s*W(\d+)\s*\/\s*(.*)$/)
  if (!p) throw new Error(`cannot parse priority/wave: ${s}`)
  const depsRaw = p[3]
  const deps = []
  const rx = /`(P[0-8]-\d{2})`/g
  let m
  while ((m = rx.exec(depsRaw))) deps.push(m[1])
  if (!depsRaw.includes('无') && depsRaw.trim().length > 0 && deps.length === 0) {
    // comma/、-separated without backticks — also collect
    for (const tok of depsRaw.split(/[、,，]/)) {
      const id = tok.match(/(P[0-8]-\d{2})/)
      if (id) deps.push(id[1])
    }
  }
  return { priority: p[1], wave: Number(p[2]), deps }
}
const parseRealTask = (s) => {
  const ev = s.match(/E([0-8])/)
  const scen = [...new Set([...s.matchAll(/S(\d{2})/g)].map((mm) => `S${mm[1]}`))].sort()
  return { evidenceClass: ev ? `E${ev[1]}` : null, scenarios: scen, note: s }
}

// ---------------------------------------------------------------------------
// 3. Parse the wave map
// ---------------------------------------------------------------------------
const WAVE_HEAD_RX = /^#{2,4}\s+W(\d{1,2})\b/
const STAGE_RX = /\*\*([CPUF])(?:\((\d+)\)|=(N\/A)):\*\*/g
// Split a markdown table row on '|' but NOT inside a backtick-code span. The
// wave-map contains file lists and prose with literal pipes inside ``...``
// (e.g. P0-05's `off|shadow|enforce`), which a naive split would corrupt.
function splitMarkdownRow(s) {
  const cells = []
  let cur = ''
  let inTick = false
  for (const ch of s) {
    if (ch === '`') inTick = !inTick
    if (ch === '|' && !inTick) {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells.map((c) => c.trim())
}
const FILE_TICK_RX = /`([^`]+)`/g
const KNOWN_EXT = /\.(ts|tsx|mjs|cjs|js|json|yaml|yml|md|html|css|lock)$/
const ROOT_DOTFILES = new Set(['.gitignore', '.npmrc', '.env'])
const isFilePath = (t) => {
  if (ROOT_DOTFILES.has(t)) return true
  if (KNOWN_EXT.test(t)) return true
  return t.includes('/')
}
const expandBraces = (p) => {
  const m = p.match(/^(.*)\{(.*)\}(.*)$/)
  if (!m) return [p]
  return m[2].split(',').map((alt) => `${m[1]}${alt}${m[3]}`)
}

/**
 * Parse a wave-map-format doc (`## W<n>` wave headers, then
 * `| Title | predecessors | **C(n):**... **P(n):**... **U(n):**... **F(n):**...
 * | Gate | Rollback |` table rows) into `id -> {wave, predecessors, stages,
 * gate, rollback}`. Shared by the canonical `implementation-wave-map.md`
 * and any BLOCKED-037 new-gap wave-map doc -- identical parsing, identical
 * trust level, identical stage file-count consistency check.
 */
function parseWaveMapText(text) {
  const waveMap = new Map()
  let wave = null
  for (const raw of text.split('\n')) {
    const wh = raw.match(WAVE_HEAD_RX)
    if (wh && Number(wh[1]) >= 1 && Number(wh[1]) <= 19) {
      wave = Number(wh[1])
      continue
    }
    // canonical epic table row: | P0-01 — title | predecessor | stages | gate | rollback |
    const row = raw.match(/^\|\s*(P[0-8]-\d{2})\s+[—-]\s*(.+?)\s*\|(.+)$/)
    if (row && wave !== null) {
      const id = row[1]
      const cells = splitMarkdownRow(row[3])
      // cells[0] = title remainder (may be empty since title was captured in row[2]); then predecessor, stages, gate, rollback
      const predecessorCell = cells[0] ?? ''
      const stageCell = cells[1] ?? ''
      const gateCell = cells[2] ?? ''
      const rollbackCell = cells[3] ?? ''
      const predecessors = predecessorCell === '—' || predecessorCell === '' || predecessorCell === '无'
        ? []
        : [...new Set([...predecessorCell.matchAll(/P[0-8]-\d{2}/g)].map((m) => m[0]))]
      const stages = {}
      STAGE_RX.lastIndex = 0
      const segs = []
      let m
      while ((m = STAGE_RX.exec(stageCell))) segs.push({ key: m[1], na: m[3] === 'N/A', count: m[3] === 'N/A' ? null : Number(m[2]), pos: m.index })
      for (let i = 0; i < segs.length; i++) {
        const end = i + 1 < segs.length ? segs[i + 1].pos : stageCell.length
        const body = stageCell.slice(segs[i].pos, end)
        const fileMatches = []
        FILE_TICK_RX.lastIndex = 0
        let fm
        while ((fm = FILE_TICK_RX.exec(body))) {
          if (isFilePath(fm[1])) fileMatches.push(fm[1])
        }
        const files = fileMatches.flatMap(expandBraces)
        let reason = null
        if (segs[i].na) {
          reason = body.replace(/\*\*P=N\/A:\*\*/, '').replace(/`[^`]+`/g, '').replace(/^\s*[—\-–]\s*/, '').trim()
          if (!reason) reason = 'kernel/reference-monitor or static rule, not a replaceable provider'
        }
        stages[segs[i].key] = segs[i].na
          ? { nOf: 'N/A', reason, files: [], count: 0 }
          : { nOf: null, files, count: files.length }
      }
      // stage file-count consistency: declared count must equal expanded count
      for (const k of ['C', 'P', 'U', 'F']) {
        if (stages[k] && !stages[k].nOf && stages[k].count !== segs.find((s) => s.key === k)?.count) {
          throw new Error(`${id} stage ${k}: declared count ${segs.find((s) => s.key === k)?.count} != expanded ${stages[k].count}`)
        }
      }
      waveMap.set(id, { wave, predecessors, stages, gate: gateCell, rollback: rollbackCell })
    }
  }
  return waveMap
}

const waveMap = parseWaveMapText(waveMapText)
if (INCLUDE_NEW_GAP) {
  for (const src of NEWGAP_SOURCES) {
    const wText = readFileSync(join(SOURCES_DIR, src.waveMap), 'utf8')
    const actualSha = sha256(wText)
    if (actualSha !== src.waveMapSha) throw new Error(`${src.waveMap}: sha mismatch (got ${actualSha}, expected ${src.waveMapSha}) -- new-gap sources are fail-closed SHA-pinned exactly like the 3 canonical docs`)
    for (const [id, entry] of parseWaveMapText(wText)) newGapWaveMap.set(id, entry)
  }
}

if (waveMap.size !== 100) throw new Error(`wave-map: expected 100 epic rows, got ${waveMap.size}`)
const wavesUsed = [...new Set([...waveMap.values()].map((e) => e.wave))].sort((a, b) => a - b)
if (wavesUsed.length !== 19 || wavesUsed[0] !== 1 || wavesUsed[18] !== 19) {
  throw new Error(`wave-map: expected waves 1..19, got ${wavesUsed.join(',')}`)
}

/**
 * Merge new-gap epics into the SAME Maps the canonical 100 already live in,
 * strictly AFTER every canonical-count/wave-coverage assertion above has
 * already run against the unmerged 100 -- so those checks keep validating
 * exactly what they always validated, unaffected by anything added here.
 * From this point on, the epic-assembly loop below runs unchanged over
 * every id in `matrix`/`waveMap`: a new-gap epic is built through the exact
 * same code path as a canonical one, not a parallel or looser one.
 */
const newGapEpicIds = new Set(newGapMatrix.keys())
for (const id of newGapEpicIds) {
  if (!newGapWaveMap.has(id)) throw new Error(`${id}: present in a new-gap matrix doc but missing from its wave-map companion`)
  if (matrix.has(id)) throw new Error(`${id}: new-gap epic id collides with an existing canonical epic id`)
}
for (const [id, entry] of newGapMatrix) matrix.set(id, entry)
for (const [id, entry] of newGapWaveMap) waveMap.set(id, entry)

// ---------------------------------------------------------------------------
// 4. Parse the decision package (primaryLayer + source-certified ambiguous ids)
// ---------------------------------------------------------------------------
const LAYER_ENUM = ['L0_KERNEL', 'L1_CONTRACT', 'L2_PROVIDER', 'L3_CONSUMER', 'L4_COMPOSITION', 'L5_SURFACE', 'L6_QUALIFICATION']
const layerById = new Map()
let inMapping = false
for (const raw of decisionText.split('\n')) {
  if (raw.includes('### Full mapping (100 rows)')) { inMapping = true; continue }
  if (raw.includes('### Layer adjudication list')) { inMapping = false; break }
  if (inMapping) {
    const m = raw.match(/^\|\s*(P[0-8]-\d{2})\s*\|\s*(L[0-6]_[A-Z_]+)\s*\|/)
    if (m) layerById.set(m[1], m[2])
  }
}
if (layerById.size !== 100) throw new Error(`decision package: expected 100 layer rows, got ${layerById.size}`)

// Decision package §2.3 enumerates 32 ambiguous ids in a backtick-delimited list.
const ambiguous = new Set()
for (const raw of decisionText.split('\n')) {
  const m = raw.match(/^`(P[0-8]-\d{2}(?:, P[0-8]-\d{2})+)`/)
  if (m) for (const id of m[1].split(',')) ambiguous.add(id.trim())
}
if (ambiguous.size !== 32) throw new Error(`expected 32 explicit ambiguous ids from decision package §2.3, got ${ambiguous.size}`)
// §2.3 names the wave-map-vs-architecture-audit §5 seam and the L1-vs-L6 / L1-vs-L2 seams.
// Every id named there is deterministically ambiguous; add any not already listed
// (currently exactly P2-09, so the source-certified set is 33).
const seamText = decisionText.split('\n').find((l) => l.includes('The dominant conflict is')) ?? ''
for (const id of seamText.matchAll(/\bP[0-8]-\d{2}\b/g)) ambiguous.add(id[0])
if (ambiguous.size < 33) throw new Error(`expected at least 33 source-certified ambiguous ids (32 explicit + seam-derived), got ${ambiguous.size}`)

// ---------------------------------------------------------------------------
// 5. Spec owners (triple-confirmed) and threshold proposals
// ---------------------------------------------------------------------------
const SPEC_OWNERS = {
  'spec/trust-kernel.md': 'P0-02.C',
  'spec/capability-manifest.schema.json': 'P1-01.C',
  'spec/action-manifest.schema.json': 'P2-03.C',
  'spec/task-profile.schema.json': 'P4-02.C',
  'spec/run-plan.schema.json': 'P4-03.C',
  'spec/verification-contract.schema.json': 'P7-01.C',
  'spec/outcome-package.schema.json': 'P7-05.C',
  'spec/control-protocol.schema.json': 'P8-01.C',
  'spec/release-gates.yaml': 'P8-10.C',
}
const specOwnerEpics = new Set(Object.values(SPEC_OWNERS).map((o) => o.split('.')[0]))
if (specOwnerEpics.size !== 9) throw new Error('spec owner epics must be exactly 9')

// thresholds from wave-map §2.2 (16 rows incl. Real-model claims)
const thresholdProposals = []
let inThresholds = false
for (const raw of waveMapText.split('\n')) {
  if (raw.startsWith('| Epic | Proposed v1.1 threshold |')) { inThresholds = true; continue }
  if (inThresholds) {
    if (raw.startsWith('## ') || raw.startsWith('| Micro-PR')) { inThresholds = false; continue }
    const m = raw.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/)
    if (m && m[1].trim() !== '---') thresholdProposals.push({ epic: m[1].trim(), proposal: m[2].trim(), status: 'PROPOSED_PENDING_MAINTAINER' })
  }
}
if (thresholdProposals.length < 15) throw new Error(`expected >=15 threshold proposals, got ${thresholdProposals.length}`)

// 13-entry evidence schema derived from decision package §4.2/§4.3/§5.1.5/§5.2
const EVIDENCE_SCHEMA = [
  { key: 'id', required: true, note: 'issue id; must equal ${id}.${lane}.json filename id' },
  { key: 'lane', required: true, enum: ['contract', 'provider', 'composition', 'fault'], note: 'must equal filename lane; all 4 lanes required per issue' },
  { key: 'baselineSha', required: true, frozen: '0a53fb55bea101816fa226bb964ae2bed71c343b', note: '"unknown" rejected' },
  { key: 'command', required: true, note: 'exact real command executed' },
  { key: 'exitCode', required: true, note: 'real exit code; per-issue exitSemantics enforced' },
  { key: 'rawLogPath', required: true, note: 'confined to .artifacts/first100/observations/; non-zero size; no path traversal' },
  { key: 'rawLogSha256', required: true, note: 'digest of the raw log; empty-log sha rejected' },
  { key: 'testCounts', required: true, note: 'parsed from raw log: pass/fail/skip/total with total>0; fabrication rejected' },
  { key: 'worldStateBefore', required: true, note: '"unobserved" rejected' },
  { key: 'worldStateAfter', required: true, note: '"unobserved" rejected' },
  { key: 'skipReason', required: true, note: 'must be empty on success; non-empty skipReason rejected and never injected' },
  { key: 'exitSemantics', required: true, note: 'per-issue mapping FAIL/NOT_RUN/BLOCKED/ACCEPTED; model/executor self-report never constitutes evidence' },
  { key: 'signature', required: true, note: 'detached attestation over canonical serialization of all fields, verified against pinned trusted identity; ACCEPTED only on verified attestation' },
]

// ---------------------------------------------------------------------------
// 6. Assemble the registry
// ---------------------------------------------------------------------------
const groupCounts = {}
const newGapCounts = {}
const epics = []
const ids = [...matrix.keys()].sort()

for (const id of ids) {
  const { title, line, fields } = matrix.get(id)
  const isNewGap = newGapEpicIds.has(id)
  const { priority, wave, deps } = parsePriorityWave(fields.priorityWave || '')
  const wm = waveMap.get(id)
  if (!wm) throw new Error(`${id}: missing wave-map row`)
  // Canonical epics get primaryLayer from r0-decision-package.md's independent
  // mapping table; a new-gap epic has no entry there (it postdates that doc),
  // so it declares its own PrimaryLayer field directly in its matrix source.
  const layer = isNewGap ? fields.primaryLayer : layerById.get(id)
  if (!layer) throw new Error(`${id}: missing layer`)
  // phase comes from the ID prefix (P0-01 → phase 0); matrix `priority` is a priority class.
  const phaseNum = Number(id[1])
  // groupCounts stays exactly what it always meant -- the 100 canonical
  // epics only, checked against EXPECTED_COUNTS below unaffected by
  // anything new-gap. New-gap epics get their own, separately-labeled
  // count so nothing here silently changes an existing field's meaning.
  if (isNewGap) newGapCounts[`P${phaseNum}`] = (newGapCounts[`P${phaseNum}`] || 0) + 1
  else groupCounts[`P${phaseNum}`] = (groupCounts[`P${phaseNum}`] || 0) + 1

  const must = splitClauses(fields.must || '')
  const acceptance = splitClauses(fields.acceptance || '')
  const nonGoals = splitClauses(fields.nonGoal || '')
  const validation = splitClauses(fields.validation || '')
  if (acceptance.length === 0) throw new Error(`${id}: empty acceptance`)
  if (nonGoals.length === 0) throw new Error(`${id}: empty nonGoals`)

  // wave-map predecessors are authoritative; matrix deps retained as declared
  const declaredDeps = wm.predecessors.length ? wm.predecessors : deps
  const realTask = parseRealTask(fields.realTask || '')

  const epic = {
    id,
    title,
    phase: phaseNum,
    priority,
    wave: wm.wave,
    predecessors: declaredDeps,
    primaryLayer: layer,
    layerSource: isNewGap ? 'base-align-v2/new-gap-matrix.md (delegate-confirmed)' : 'r0-decision-package.md §2 full mapping (Agent A)',
    layerStatus: isNewGap ? 'DELEGATE_CONFIRMED' : ambiguous.has(id) ? 'PENDING_MAINTAINER_ADJUDICATION' : 'AGENT_A_PROPOSED',
    canonicalOwner: specOwnerEpics.has(id) ? id : 'UNASSIGNED_UNTIL_APPROVAL',
    files: applyFileReplacements(id, [
      ...parseFiles(fields.files || ''),
      ...(TEST_FILES_ADDED[id]?.added ?? []).map(({ path, kind }) => ({ path, kind })),
      ...(CONSUMERS_ADDED[id]?.added ?? []).map(({ path, kind }) => ({ path, kind })),
    ]),
    usageConsumers: (CONSUMERS_ADDED[id]?.added ?? []).filter(entry => entry.stage === 'U').map(entry => entry.path),
    must,
    acceptance,
    nonGoals,
    acceptanceSource: isNewGap
      ? { path: 'base-align-v2/new-gap-matrix.md', sha256: NEWGAP_MATRIX_SHA, line }
      : { path: 'first100-requirements-matrix.md', sha256: MATRIX_SHA, line },
    validation,
    verifyCommand: fields.verifyCommand || null,
    realTask,
    stages: wm.stages,
    fixtures: {
      contract: `tests/first100/fixtures/${id}.contract.spec.ts`,
      provider: `tests/first100/fixtures/${id}.provider.spec.ts`,
      composition: `tests/first100/fixtures/${id}.composition.spec.ts`,
      fault: `tests/first100/fixtures/${id}.fault.spec.ts`,
    },
    gate: wm.gate,
    rollback: wm.rollback,
    // Absent = implicitly canonical (CANONICAL_EXTRACTION_FROM_PINNED_SOURCES,
    // matching the registry's own top-level provenance.status). Present =
    // BASE-ALIGN-v2 new-gap: its equivalent obligation is tracing every
    // clause to THIS source (checkNewGapClauseCoverage in generate-specs.ts),
    // not to the v1.0 YAML the 100 canonical epics trace to.
    ...(isNewGap
      ? {
          provenance: {
            kind: 'BASE-ALIGN-v2 new-gap',
            source: { path: 'spec/first100/sources/base-align-v2/new-gap-matrix.md', sha256: NEWGAP_MATRIX_SHA },
            rationaleDoc: 'spec/first100/sources/base-align-v2/upstream-status-COMPLETE.md §三',
            authorization: 'decisions-approved.md#C8',
          },
        }
      : {}),
    ...(clauseProvenanceFor(id).length > 0 ? { clauseProvenance: clauseProvenanceFor(id) } : {}),
  }
  for (const replacement of FILES_REPLACED[id]?.replacements ?? []) {
    const stage = epic.stages[replacement.stage]
    if (stage?.files === undefined || !stage.files.includes(replacement.from)) {
      throw new Error(`${id}: file replacement expects ${replacement.from} in stage ${replacement.stage}, which does not declare it`)
    }
    stage.files = stage.files.map(path => path === replacement.from ? replacement.to : path)
  }
  for (const addition of TEST_FILES_ADDED[id]?.added ?? []) {
    const stage = epic.stages[addition.stage]
    if (stage === undefined || stage.files === undefined) {
      throw new Error(`${id}: added test file names stage ${addition.stage}, which this epic does not have`)
    }
    stage.files = [...stage.files, addition.path]
    stage.count = stage.files.length
  }
  for (const addition of CONSUMERS_ADDED[id]?.added ?? []) {
    const stage = epic.stages[addition.stage]
    if (stage === undefined || stage.files === undefined) {
      throw new Error(`${id}: added consumer names stage ${addition.stage}, which this epic does not have`)
    }
    stage.files = [...stage.files, addition.path]
    stage.count = stage.files.length
  }
  for (const scaffold of SCAFFOLD_FILES[id]?.added ?? []) {
    // Epic-level `files` already declares the path -- the registry named it,
    // it just named it in the wrong STAGE. Only the stage membership is new,
    // so appending to `files` here would duplicate the row.
    if (!epic.files.some(file => file.path === scaffold.path)) {
      throw new Error(`${id}: scaffold file ${scaffold.path} is not among the epic's declared files`)
    }
    const stage = epic.stages[scaffold.stage]
    if (stage === undefined || stage.files === undefined) {
      throw new Error(`${id}: scaffold file names stage ${scaffold.stage}, which this epic does not have`)
    }
    stage.files = [...stage.files, scaffold.path]
    stage.count = stage.files.length
  }
  for (const entry of clauseProvenanceFor(id)) {
    // A movement or split is always a MUST clause today; a reword names its own
    // channel, because P4-06's pair spans `must` and `acceptance`. Checking the
    // wrong channel would report a real edit as a disagreement, and checking
    // none would let a record name a clause the matrix never got.
    const channel = entry.channel ?? 'must'
    if (!epic[channel].includes(entry.clause)) {
      throw new Error(`${id}: clause provenance records "${entry.clause}" but the matrix does not give ${id} that ${channel.toUpperCase()} clause -- the doc edit and this record disagree`)
    }
  }
  epics.push(epic)
}

const EXPECTED_COUNTS = { P0: 8, P1: 12, P2: 12, P3: 12, P4: 14, P5: 12, P6: 10, P7: 10, P8: 10 }
for (const [g, n] of Object.entries(EXPECTED_COUNTS)) {
  if (groupCounts[g] !== n) throw new Error(`group ${g}: expected ${n}, got ${groupCounts[g]}`)
}

// DAG sanity: every predecessor is a known id in a strictly earlier wave, no cycles
const waveById = new Map(epics.map((e) => [e.id, e.wave]))
for (const e of epics) {
  for (const dep of e.predecessors) {
    if (!waveById.has(dep)) throw new Error(`${e.id}: unknown predecessor ${dep}`)
    if (waveById.get(dep) >= e.wave) throw new Error(`${e.id}: predecessor ${dep} not in an earlier wave (${waveById.get(dep)} >= ${e.wave})`)
  }
}

const registry = {
  schema: { name: 'first100-registry', version: '1.1', kind: 'canonical-source-of-truth', generatedFrom: 'planning sources (matrix + wave-map + decision package)' },
  frozenBaseline: {
    sha: '4e84901e6471b79ec0338099867ebb4606d12bb5',
    shortSha: '4e84901e',
    label: 'baseline-4e84901e',
    note: 'All First-100 evidence binds to this exact SHA (upstream master tip re-anchored via BASE-ALIGN-v2, 2026-09-03; supersedes baseline-0a53fb55, downgraded to audit provenance per BLOCKED-016).',
  },
  layerEnum: LAYER_ENUM,
  ownerStates: ['UNASSIGNED_UNTIL_APPROVAL'],
  groupCounts: EXPECTED_COUNTS,
  // Separate field from groupCounts by design (BLOCKED-037): groupCounts
  // keeps meaning exactly what it always meant -- the 100 canonical epics
  // -- never redefined to "the total" and never silently including
  // new-gap epics. Present only when at least one new-gap epic actually
  // exists in this build (matching sourcePins'/provenance's own
  // absent-not-zeroed convention below) -- so today's committed
  // registry.json, extracted with INCLUDE_NEW_GAP off, stays byte-for-byte
  // unchanged by this field's existence. Extractor-computed, never
  // hand-edited.
  ...(newGapEpicIds.size > 0 ? { newGapCounts } : {}),
  waveCount: 19,
  exitSemantics: {
    accept: 'ACCEPTED',
    fail: 'FAIL',
    notRun: 'NOT_RUN',
    blocked: 'BLOCKED',
    failClosedRule: 'typed deny/refuse/incompatible/uncertain states fail closed per item text; missing dependency/path/threshold/evidence is BLOCKED; unexecuted command is NOT_RUN; model/executor self-report never constitutes evidence',
    appliesTo: 'all 100 epics (uniform; per-epic override field reserved)',
  },
  sourcePins: {
    'first100-requirements-matrix.md': { sha256: MATRIX_SHA, role: 'verbatim acceptance/nonGoals/files/must/validation/command source' },
    'implementation-wave-map.md': { sha256: WAVEMAP_SHA, role: 'wave/predecessor/stage/gate/rollback source' },
    'r0-decision-package.md': { sha256: sha256(decisionText), role: 'primaryLayer mapping + source-certified ambiguous ids + R0.1/R0.4 rule set' },
    // Output only, never input (BLOCKED-037): these entries are a record of
    // what was consumed, written here after the fact from the same
    // NEWGAP_SOURCES constant the extractor already read from -- this
    // object is never read back to decide what to extract. Present only
    // when INCLUDE_NEW_GAP actually ran; absent (not merely empty) when it
    // didn't, so this field's own shape honestly reflects whether any
    // new-gap source was consulted for this specific build.
    ...(INCLUDE_NEW_GAP
      ? Object.fromEntries(NEWGAP_SOURCES.flatMap((src) => [
          [src.matrix, { sha256: src.matrixSha, role: 'BASE-ALIGN-v2 new-gap epic matrix-format source' }],
          [src.waveMap, { sha256: src.waveMapSha, role: 'BASE-ALIGN-v2 new-gap epic wave-map-format source' }],
        ]))
      : {}),
  },
  specOwners: SPEC_OWNERS,
  thresholdProposals,
  adjudicationPending: {
    count: ambiguous.size,
    enumerated: ambiguous.size,
    notEnumeratedFromSources: {
      claimedByDecisionPackage: 2,
      sourceCertified: 1,
      gap: 1,
      note: 'Decision package §2.3 claims 2 more ambiguous ids than the 32 it lists but does not enumerate them; the Agent A transcript UNCERTAINTIES table is the only source and is not vendored. P2-09 is source-certified via the §2.3 wave-vs-audit seam, leaving 1 id enumerable only from the missing transcript.',
    },
    layerIds: [...ambiguous].sort(),
    status: 'PENDING_MAINTAINER',
    note: 'Agent A chose the layers in the table; these ids must be confirmed/adjudicated (ADR) before the v1.1 envelope is signed. Enumerated ids are the 32 explicit in decision package §2.3 plus P2-09 from the named wave-vs-audit seam; the claimed 34th is not enumerable from committed sources.',
  },
  evidenceSchema: EVIDENCE_SCHEMA,
  generatedArtifacts: {
    manifest: 'spec/deepseek-harness-optimization-manifest-v1.1.yaml',
    ownerMap: 'spec/first100-owner-map.json',
    dependencyGraph: 'spec/first100-dependency-graph.json',
    commandRegistry: 'spec/first100-command-registry.json',
    thresholds: 'spec/first100-thresholds.yaml',
    evidenceSchema: 'spec/first100-evidence.schema.json',
    digests: 'spec/first100-generated-digests.json',
  },
  provenance: {
    status: 'CANONICAL_EXTRACTION_FROM_PINNED_SOURCES',
    note: 'Deterministically extracted from the pinned vendored planning sources. Extraction is reproducible (byte-identical via --check). This does NOT constitute maintainer adjudication: the source-certified ambiguous layer ids (33; the claimed 34th is transcript-only), 17 threshold proposals, and canonical owner assignment remain PENDING_MAINTAINER_ADJUDICATION until R0-7.',
    extractor: 'scripts/first100/extract-registry.mjs',
    vendoredSources: 'spec/first100/sources/',
    sourceShas: {
      'spec/first100/sources/first100-requirements-matrix.md': MATRIX_SHA,
      'spec/first100/sources/implementation-wave-map.md': WAVEMAP_SHA,
      'spec/first100/sources/r0-decision-package.md': sha256(decisionText),
    },
    reproducible: 'node scripts/first100/extract-registry.mjs --check must exit 0 (byte-identical); enforced by scripts/first100/registry-regenerate.spec.ts',
    // BLOCKED-037: an honest completion, not a redefinition, of `status`
    // above. Leaving `status: CANONICAL_EXTRACTION_FROM_PINNED_SOURCES`
    // unqualified once this registry also holds non-canonical epics would
    // let the FIRST thing any reader/auditor sees overclaim the registry's
    // own purity -- the same failure shape as a name-scoped guard calling
    // itself type-scoped. This field is the honest completion: it names
    // exactly how many epics are canonical vs. new-gap, their ids, source,
    // and authorization, right next to the status a reader hits first.
    // Present only when at least one new-gap epic actually exists in this
    // specific build (INCLUDE_NEW_GAP on); omitted, not zeroed, otherwise --
    // matching sourcePins' own honesty-about-absence convention above.
    ...(newGapEpicIds.size > 0
      ? {
          newGapEpics: {
            canonicalCount: epics.length - newGapEpicIds.size,
            newGapCount: newGapEpicIds.size,
            epicIds: [...newGapEpicIds].sort(),
            note: 'These epics did not come from the 3 canonical pinned docs above -- they describe capability gaps upstream introduced after those docs were written. Each carries its own per-epic `provenance` field (source doc + SHA, rationale doc, authorization record); see decisions-approved.md#C8 for the reserved-scope authorization that permitted adding them.',
          },
        }
      : {}),
    // Present only once at least one of the 23 authorized epics has actually
    // been rescoped (RESCOPE23_EPIC_IDS non-empty); omitted, not zeroed,
    // otherwise -- same absence convention as newGapEpics above.
    ...(RESCOPE23_EPIC_IDS.length > 0
      ? {
          baseAlignV2Rescope23: {
            epicIds: [...RESCOPE23_EPIC_IDS].sort(),
            priorMatrixSha256: RESCOPE23_PRIOR_MATRIX_SHA,
            rescopeSpec: 'spec/first100/sources/base-align-v2/23-partial-rescope-spec.md',
            note: 'These canonical epics\' `must` text was narrowed in-place in first100-requirements-matrix.md to the delta not yet covered by upstream 4e84901e, per the rescope spec\'s own per-epic evidence (BLOCKED-012 discipline: only a MUST fragment with direct, fully-covering upstream evidence was removed; a partially-covered fragment was kept in full). acceptance/files/validation/nonGoals were left untouched for every epic rescoped so far. priorMatrixSha256 is the matrix doc\'s content hash BEFORE this rescope; sourceShas above reflects the state AFTER.',
          },
        }
      : {}),
    ...(Object.keys(CLAUSE_MOVEMENTS).length > 0
      ? {
          filesReduced: {
            epicIds: Object.keys(FILES_REDUCED).sort(),
            order: 'spec/first100/exec/plan-rectification-2026-09-06.md §C',
            entries: FILES_REDUCED,
          },
          filesReplaced: {
            epicIds: Object.keys(FILES_REPLACED).sort(),
            note: 'Files whose DECLARED path cannot hold what the clause needs, replaced with the path that can. Each entry states the mechanical reason, because only "the declared place could not hold it" justifies editing a pinned list.',
            entries: FILES_REPLACED,
          },
          testFilesAdded: {
            epicIds: Object.keys(TEST_FILES_ADDED).sort(),
            note: "Test files added because an epic's unlock signal named an observation none of its declared files could make. The epic's own work, not convention-forced scaffolding, so unlike scaffoldFiles these count against the stage.",
            entries: TEST_FILES_ADDED,
          },
          scaffoldFiles: {
            epicIds: Object.keys(SCAFFOLD_FILES).sort(),
            note: 'Files a repository-wide convention forces into an epic that its clauses never named. Admitted under B4(f) without counting against the stage limit, because the epic did not choose to write them. Each entry names the convention, so the admission is reversible when the convention is.',
            entries: SCAFFOLD_FILES,
          },
          hotZoneRelocated: {
            epicIds: Object.keys(HOT_ZONE_RELOCATED).sort(),
            order: 'spec/first100/exec/plan-rectification-2026-09-06.md §D',
            entries: HOT_ZONE_RELOCATED,
          },
          clauseMovements: {
            destinations: Object.keys(CLAUSE_MOVEMENTS).sort(),
            count: Object.values(CLAUSE_MOVEMENTS).reduce((n, entries) => n + entries.length, 0),
            priorMatrixSha256: PRE_CLAUSE_MOVEMENT_MATRIX_SHA,
            note: 'Clauses re-anchored to the epic that owns the mechanism, by approved ruling. Each destination epic carries the origin, date, basis and reason in its own `clauseProvenance`; priorMatrixSha256 is the matrix doc\'s content hash BEFORE the movements, sourceShas above reflects the state AFTER.',
          },
        }
      : {}),
  },
  epics,
}

const serialized = JSON.stringify(registry, null, 2) + '\n'

if (CHECK) {
  const committed = readFileSync(OUT_PATH, 'utf8')
  if (committed !== serialized) {
    console.error(`DRIFT tests/first100/registry.json: committed bytes differ from a fresh extraction of ${SOURCES_DIR}`)
    process.exit(1)
  }
  console.log('verify: registry.json byte-identical to pinned vendored sources')
  process.exit(0)
}

writeFileSync(OUT_PATH, serialized)
console.log(`wrote ${OUT_PATH}`)
console.log(`epics=${epics.length} unique=${new Set(epics.map((e) => e.id)).size} groups=${JSON.stringify(groupCounts)}`)
console.log(`ambiguous=${ambiguous.size} layers=${new Set(epics.map((e) => e.primaryLayer)).size} waves 1..19 ok`)
console.log(`evidenceSchema entries=${EVIDENCE_SCHEMA.length} thresholds=${thresholdProposals.length}`)
