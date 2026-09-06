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
