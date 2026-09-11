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
 * Usage: `node scripts/first100/run-registry-gates.mjs`
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
const GATES = [
  'first100:verify-typecheck-host',
  'first100:verify-registry-extraction',
  'first100:verify-specs',
  'first100:test-specs',
  'first100:verify-baseline-file-references',
  'first100:verify-frozen-titles-resolvable',
  'first100:verify-p9-cells',
  'first100:verify-make-vs-use',
  'first100:verify-freeze-in-candidate-tree',
  'first100:verify-files-overlay',
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
  'verify-import-integrity',
  'verify-no-artifacts-in-src',
  'verify-control-protocol-schema',
  'verify-module-graph',
  'verify-export-jsdoc',
  'verify-doc-budgets',
  'verify-translation-pairing',
  'constraints',
  'architecture:layers',
]

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
      '14 bilingual doc pairs are out of sync — the English side of several READMEs and docs/subsystems/core.md moved without its Chinese counterpart. '
      + 'The fix is translation, and AGENTS.md reserves `dsh-translate-docs` to explicit user invocation; re-recording the pair state instead would tell '
      + 'the gate the two sides agree when they do not.',
    until: 'BLOCKED-124 closes — the user authorizes the translation pass, or rules which pairs diverge only cosmetically.',
  }],
  ['verify-import-integrity', {
    reason:
      'The gate is new and the tree it lands on already violates it 12 times in 8 packages, none of them owned by the lane that wrote it. '
      + 'Running it red would fail every push over other lanes\' manifests, and editing eight other epics\' packages to land a gate is the '
      + 'scope creep the program forbids. Each violation with the owner the registry actually gives, because "declared by their owning '
      + 'packages" needs a subject or nobody reads it:\n'
      + '             dsh-retry -> @deepseek-ai/schemastery (reliability/retry/src/usage.ts:13) — THE defect this gate was asked for, still '
      + 'undeclared on this base. Package is P4-11\'s, but `usage.ts` is NOT among P4-11\'s declared files (it declares index/classify/budget/'
      + 'circuit.ts), so the path arrived through an overlay: attributed to P4-11 by package, not by registry path. Closes BLOCKED-186.\n'
      + '             @deepseek-ai/dsh -> dsh-brand, three files. apps/cli/src/plugin.ts is named by seven epics (P1-01/02/03/04/05/10/12) '
      + 'and profile-boot.ts by six (P0-02, P0-05, P1-01, P1-03, P1-07, P8-10) — a shared file the registry cannot attribute to one owner; '
      + 'plugin-migration.ts is named by NO epic at all. Owner is the apps/cli manifest, whoever touches it next.\n'
      + '             dsh-agent-loop -> dsh-capability-token (core/agent-loop/src/tool-calls.ts:20). Named by six epics '
      + '(P2-03, P2-05, P2-06, P3-03, P4-12, P7-02); the import itself is P2-02\'s capability-token line, so P2-02 by subject.\n'
      + '             dsh-repeat-tool-reminder -> dsh-llm (guard/repeat-tool-reminder/src/index.ts:12) — P7-06, unambiguous.\n'
      + '             dsh-web-frontend -> dsh-client-web (apps/web/src/main.ts:2) — P8-08, unambiguous; '
      + '-> dsh-experimental-webworker-runtime (apps/web/src/preview.ts:9) — unowned.\n'
      + '             dsh-tmux-context -> dsh-llm, dsh-tool-skill -> dsh-session, and dsh-experimental-webworker-runtime -> dsh-app-boot '
      + 'and dsh-cmdline — all four unowned: no registry epic names those files.',
    until:
      'all 12 are declared by the manifests above. Unowned paths have no epic to wait for, so they go to whoever edits that manifest next '
      + 'rather than to a queue. The gate is exercised meanwhile by scripts/verify-import-integrity.spec.ts, whose 14 cases include the '
      + 'positive control this hold would otherwise hide: the same import is reported when undeclared and silent once declared.',
  }],
])

function main() {
  const held = GATES.filter(gate => HELD_BACK.has(gate))
  for (const gate of held) {
    const { reason, until } = HELD_BACK.get(gate)
    console.log(`HELD BACK  ${gate}`)
    console.log(`           ${reason}`)
    console.log(`           Reinstated when: ${until}`)
  }

  const running = GATES.filter(gate => !HELD_BACK.has(gate))
  for (const gate of running) {
    console.log(`\n=== ${gate}`)
    const result = spawnSync('pnpm', ['run', gate], { cwd: REPO_ROOT, stdio: 'inherit' })
    if (result.status !== 0) {
      console.error(`\nregistry gate set: ${gate} failed (exit ${String(result.status)}).`)
      process.exit(1)
    }
  }
  console.log(
    `\nregistry gate set: ${String(running.length)} gate(s) passed`
    + `${held.length > 0 ? `, ${String(held.length)} held back with a stated reason above` : ''}.`,
  )
}

main()
