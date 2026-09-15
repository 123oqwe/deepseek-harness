/**
 * Run the First-100 registry gate set, printing any gate held back and why.
 *
 * The set exists so the registry itself is checked — generated artifacts
 * byte-identical, declared file references valid, frozen titles resolvable —
 * before an observation is taken against it. Until 2026-09-06 no workflow ran
 * it at all: every gate in it fired only when someone typed the command, and in
 * five days of that it missed twelve build artifacts committed under a source
 * directory, 23 JSDoc violations, three stale generated documents and three
 * malformed `files` arrays.
 *
 * **Why this is a script and not a `&&` chain.** One gate is currently held
 * back, and the two obvious ways to express that are both wrong. Dropping it
 * from a second, CI-only chain leaves two lists free to diverge, and the one
 * nobody runs locally is the one that rots. Re-recording its state to make it
 * pass would assert a consistency that does not exist. What is correct is to
 * run the set, skip the named gate, and say so on every run — a held-back gate
 * that announces itself is a different thing from one quietly absent.
 *
 * **Why it does not stop at the first failure.** Every non-held gate runs and
 * the report names each one's exit. An `&&` chain stops at the first red, so a
 * permanently-held gate early in the list hides everything after it: six of
 * `first100:slice-gate`'s ten gates went unexecuted for as long as the pairing
 * gate has been held, and a real `verify-registry-extraction` failure sat
 * behind them (BLOCKED-181). "Which gates ran, and how each ended" is the
 * question a lane report has to answer; one exit code cannot.
 *
 * Usage: `node scripts/first100/run-registry-gates.mjs [--set registry|slice|slice-cordis]`
 *
 * @module scripts/first100/run-registry-gates
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The gates, in run order.
 *
 * Ordered cheapest-first among the registry checks so a malformed registry
 * fails before a multi-minute typecheck, except `verify-typecheck-host`, which
 * comes first because a tree that does not compile makes every later gate's
 * verdict uninformative.
 */
const REGISTRY_GATES = [
  'first100:verify-typecheck-host',
  // The host typecheck sees a scripts/first100 .mjs module only through its
  // .d.mts; this reads the source text and answers the declaration half of that
  // question in under a second.
  'first100:verify-dmts-declarations',
  'first100:verify-registry-extraction',
  'first100:verify-specs',
  'first100:test-specs',
  'first100:verify-baseline-file-references',
  'first100:verify-frozen-titles-resolvable',
  'first100:verify-p9-cells',
  'first100:verify-make-vs-use',
  'first100:verify-freeze-in-candidate-tree',
  'first100:verify-files-overlay',
  'first100:verify-declared-files-exist',
  'first100:verify-manifest-constructed',
  'first100:verify-run-enabled-in-bundles',
  // The ledger's own digest check. It lived only in the push gate, so a
  // registry edit could leave EXEC-STATE stale through a full green gate-set
  // run -- which happened twice: once after SCAFFOLD_FILES changed
  // registry.json, and again after P1-03's files[] swap. A check that runs
  // only where someone remembers to run it is the shape this program keeps
  // recording.
  'first100:verify-ledger-digests',
  'first100:verify-boot-path-offline',
  'first100:verify-adapt-dispositions',
  // The generated session-event vocabulary. A `SessionEventMap` `declare
  // module` merge whose generator was never run leaves
  // `KNOWN_SESSION_EVENT_TYPES` without the event the same build writes, and
  // the persistence read path then refuses a log carrying it unless the
  // envelope marks it `ignorable` -- a build declining to read its own output.
  // It reddened on P4-02's C stage while this set reported 22/22 green,
  // because the set did not contain it (BLOCKED-192).
  'verify-persistence-catalog',
  'verify-import-integrity',
  'verify-no-artifacts-in-src',
  'verify-control-protocol-schema',
  // Placement only. It checks which section an existing declaration sits in
  // and at what range — which is real (it caught `core/session` declaring a
  // type-only import as a runtime dependency). It does NOT check
  // COMPLETENESS: measured 2026-09-10, deleting an imported package's
  // declaration outright leaves this gate green, for a workspace package as
  // well as for `@deepseek-ai/schemastery`. So running it here does not close
  // the undeclared-import class that broke the shipped profile's boot
  // (BLOCKED-186); that needs a check this one does not perform.
  'verify-package-dependencies',
  'verify-module-graph',
  'verify-export-jsdoc',
  'verify-doc-budgets',
  'verify-translation-pairing',
  'constraints',
  'architecture:layers',
]

/**
 * The per-slice gate set a lane runs before reporting a SHA.
 *
 * Ordered so the cheap structural checks fail before the multi-minute
 * typecheck, and `verify-registry-extraction` sits with them because a
 * hand-edited registry is a fast, common and total failure.
 */
const SLICE_GATES = [
  'verify-module-graph',
  'verify-export-jsdoc',
  'verify-doc-budgets',
  'verify-translation-pairing',
  'constraints',
  // Placement only, not completeness — see the note in the registry set.
  'verify-package-dependencies',
  'first100:verify-dmts-declarations',
  'first100:verify-typecheck-host',
  'first100:verify-registry-extraction',
]

/** The slice set plus the three Cordis-surface catalogs. */
const SLICE_CORDIS_GATES = [
  ...SLICE_GATES,
  'verify-cordis-catalog',
  'verify-cordis-api',
  'verify-cordis-inspect-catalog',
]

/** The named sets `--set` selects. */
const SETS = new Map([
  ['registry', REGISTRY_GATES],
  ['slice', SLICE_GATES],
  ['slice-cordis', SLICE_CORDIS_GATES],
])

/**
 * Gates held back, each with the reason and the condition that reinstates it.
 *
 * A held-back gate is not an exempt one: the entry states what makes it red and
 * what closes that, and both are printed on every run. An exemption with no
 * stated end is how a temporary hole becomes permanent.
 */
const HELD_BACK = new Map([
  ['verify-translation-pairing', {
    reason:
      'As of 9b87b4beb36a0e138330c5fc2fccfc3c4522ec46 (measured with the un-hold change applied but uncommitted; it touches no pairing input), measured by `npx tsx scripts/verify-translation-pairing.ts --list`: 880 ok, 12 out-of-sync, 28 missing, of 920 pairs in scope. '
      + 'These numbers were measured when this text was written and are not regenerated; re-run that command before trusting them or reinstating the gate. '
      + 'An earlier version of this note said 14 pairs and named docs/subsystems/core.md — the count was wrong and core.md is not among them '
      + '(docs/subsystems/subagent.md is), which is what a hand-maintained number does when the tree moves under it.\n'
      + '             The 12 out-of-sync are NOT "the English side moved ahead". Compared against the blob each .i18n.yaml records, both sides have '
      + 'changed in all 12 — the re-anchor merged upstream edits to both languages. Whether a pair can be closed by '
      + 're-recording depends on whether its two sides are consistent WITH EACH OTHER, which this measurement does not '
      + 'show: a pair whose translation was kept in step looks exactly like this. The work '
      + 'concentrates in one pair: docs/persistence-catalog.md is EN +458/-89 with 254 lines of fence divergence (938 vs 684), while the other '
      + 'eleven total EN +138/-56. Three pairs carry fence differences (254 / 15 / 6 lines); fences are byte-identical by contract, so that part is '
      + 'mechanical. The remaining nine differ only in prose.\n'
      + '             The 28 `missing` are a different fact: their Chinese side does not exist at all. They need new translation, not reconciliation, '
      + 'and counting them together with the 12 would hide that.\n'
      + '             The fix is translation, and AGENTS.md reserves `dsh-translate-docs` to explicit user invocation; re-recording the pair state '
      + 'instead would tell the gate the two sides agree when they do not.',
    until:
      'BLOCKED-124 closes — the user authorizes the translation pass, or rules which pairs diverge only cosmetically. The per-pair sizes above are '
      + 'the input to that decision: three pairs changed by equal amounts on both sides (+1/-1, +1/-1, +24/-9), and a fourth '
      + '(packages/context/memory-context/README.md, EN +17/-0 vs ZH +16/-0) differs only by line wrapping. Equal amounts is '
      + 'a proxy for symmetry and it is noisy BOTH ways: docs/architecture.md passes it while being substantive, and the '
      + 'memory-context pair fails it while being fully parallel. Which pairs are merely cosmetic is a reading of content '
      + 'rather than a measurement and is left to the ruling. Re-run the gate before reinstating; this entry states '
      + 'what was true at 9b87b4beb36a0e138330c5fc2fccfc3c4522ec46, not what is true now.',
  }],
])

/**
 * The set named on the command line, defaulting to the registry set.
 * @param argv - the process arguments after the script path.
 * @returns the set's name and its gates.
 */
function selectSet(argv) {
  const index = argv.indexOf('--set')
  if (index === -1) return { name: 'registry', gates: REGISTRY_GATES }
  const name = argv[index + 1]
  const gates = SETS.get(name)
  if (gates === undefined) {
    console.error(`run-registry-gates: unknown set "${String(name)}"; known: ${[...SETS.keys()].join(', ')}`)
    process.exit(2)
  }
  return { name, gates }
}

function main() {
  const { name: setName, gates } = selectSet(process.argv.slice(2))
  const held = gates.filter(gate => HELD_BACK.has(gate))
  for (const gate of held) {
    const { reason, until } = HELD_BACK.get(gate)
    console.log(`HELD BACK  ${gate}`)
    console.log(`           ${reason}`)
    console.log(`           Reinstated when: ${until}`)
  }

  // EVERY non-held gate runs, whatever an earlier one did. Stopping at the
  // first failure is what an `&&` chain does, and it is why six of
  // `first100:slice-gate`'s ten gates went unexecuted for as long as the
  // pairing gate has been held -- long enough to hide a real
  // `verify-registry-extraction` red (BLOCKED-181). A report that says which
  // gates ran and how each ended is the point; the exit code alone is not.
  const running = gates.filter(gate => !HELD_BACK.has(gate))
  const failed = []
  for (const gate of running) {
    console.log(`\n=== ${gate}`)
    const result = spawnSync('pnpm', ['run', gate], { cwd: REPO_ROOT, stdio: 'inherit' })
    const status = result.status ?? 1
    if (status !== 0) failed.push({ gate, status })
  }

  console.log(`\n${setName} gate set — per-gate result:`)
  for (const gate of running) {
    const failure = failed.find(entry => entry.gate === gate)
    console.log(`  ${failure === undefined ? 'PASS' : `FAIL (exit ${String(failure.status)})`}  ${gate}`)
  }
  for (const gate of held) console.log(`  HELD        ${gate}`)

  if (failed.length > 0) {
    console.error(
      `\n${setName} gate set: ${String(failed.length)} of ${String(running.length)} gate(s) failed `
      + `(${failed.map(entry => entry.gate).join(', ')}).`,
    )
    process.exit(1)
  }
  console.log(
    `\n${setName} gate set: ${String(running.length)} gate(s) passed`
    + `${held.length > 0 ? `, ${String(held.length)} held back with a stated reason above` : ''}.`,
  )
}

main()
