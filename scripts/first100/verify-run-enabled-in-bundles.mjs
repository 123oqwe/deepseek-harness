/**
 * §12.20-1's structural gate: every shipped bundle mounts the Run Service.
 *
 * **A capability nothing reaches is not delivered.** P4-07's fencing path had
 * production callers and, measured, no launched profile that reached them: the
 * `run` row was `disabled: true` in the shared base and no shipped bundle
 * re-enabled it, so `Agent.runLease` was `undefined` on every profile, tool
 * dispatch presented no token, and the refusal branch existed for tests only.
 * Gate (u) checks which files a stage touched and 4.4a counts a subject's
 * production callers; this is the third question — whether a launched profile
 * REACHES them.
 *
 * The check is deliberately narrow: the `run` row exists and is not disabled,
 * in the base patch every shipped bundle layers over and in any bundle that
 * restates the row. It says nothing about whether a Run is opened at runtime,
 * which is a composition test's job (`packages/run/run/tests/`), not a
 * grep's.
 *
 * Usage: `node scripts/first100/verify-run-enabled-in-bundles.mjs`
 *
 * @module scripts/first100/verify-run-enabled-in-bundles
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BUNDLE_ROOT = join(REPO_ROOT, 'packages/bundle')

/** The plugin whose absence made P4-07's refusal path unreachable. */
const REQUIRED_ROW = '@deepseek-ai/dsh-run'

/**
 * Whether a bundle's patch mounts `name` without disabling it.
 *
 * Reads the row as text rather than parsing the YAML, because the patch
 * carries `!!js` tags the standard loader refuses and this check needs no
 * evaluation — it needs to know whether the row says `disabled: true`.
 * @param source - the patch file's contents.
 * @param name - the plugin package name to find.
 * @returns `'absent'`, `'disabled'`, or `'enabled'`.
 */
export function rowState(source, name) {
  const index = source.indexOf(`name: '${name}'`)
  if (index === -1) return 'absent'
  // The row runs to the next entry's `- id:` at the same indentation, or to
  // the end. `disabled` anywhere inside that span belongs to this row.
  const rest = source.slice(index)
  const end = rest.indexOf('\n    - id:')
  const row = end === -1 ? rest : rest.slice(0, end)
  return /^\s*disabled:\s*true\s*$/mu.test(row) ? 'disabled' : 'enabled'
}

function main() {
  const bundles = readdirSync(BUNDLE_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)

  const patches = bundles
    .map(bundle => ({ bundle, path: join(BUNDLE_ROOT, bundle, 'cordis.patch.yml') }))
    .filter(entry => existsSync(entry.path))

  const states = patches.map(({ bundle, path }) => ({
    bundle,
    state: rowState(readFileSync(path, 'utf8'), REQUIRED_ROW),
  }))

  const disabled = states.filter(entry => entry.state === 'disabled')
  const enabled = states.filter(entry => entry.state === 'enabled')

  if (disabled.length > 0) {
    console.error(
      `verify-run-enabled-in-bundles: ${String(disabled.length)} bundle(s) disable ${REQUIRED_ROW}: ${disabled.map(entry => entry.bundle).join(', ')}.\n`
      + 'A disabled Run Service means no Run, no lease, and no fencing token on any launched profile — P4-07\'s refusal path\n'
      + 'would have callers that nothing reaches (§12.20-1). Derive the store path from the profile\'s storage root and enable the row.\n',
    )
    process.exit(1)
  }
  if (enabled.length === 0) {
    // The positive control this gate needs: a check that only ever looks for
    // `disabled: true` passes just as happily against a repository where the
    // row was deleted outright.
    console.error(
      `verify-run-enabled-in-bundles: no bundle mounts ${REQUIRED_ROW} at all, in ${String(patches.length)} patch file(s).\n`
      + 'Nothing is disabled, and nothing opens a Run either.\n',
    )
    process.exit(1)
  }
  console.log(
    `verify-run-enabled-in-bundles: ${REQUIRED_ROW} is mounted and not disabled in ${String(enabled.length)} of ${String(patches.length)} bundle patch file(s).`,
  )
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
