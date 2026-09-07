/**
 * P2-03 must[0]'s structural half: the manifest record has a production
 * builder (§12.11 item 3b, BLOCKED-143).
 *
 * A behavioural case can assert that a logged event carries an
 * `idempotencyKey`. It cannot assert that the value came from an
 * `ActionManifest` rather than from a payload assembled beside one — and that
 * distinction is the whole of BLOCKED-143: for the program's first hundred
 * freezes, `createActionManifest` had ZERO production callers while must[0]
 * said the manifest mandates the field.
 *
 * So this counts callers, the way 4.4a asks a human to. Tests are excluded on
 * purpose: a clause subject exercised only by its own tests is exactly the
 * condition this check exists to refuse.
 *
 * Usage: `node scripts/first100/verify-manifest-constructed.mjs`
 *
 * @module scripts/first100/verify-manifest-constructed
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** The package that owns the builder; its own files are not callers of it. */
const OWNER = 'packages/action/action-manifest/'

/**
 * Production files calling `createActionManifest`.
 *
 * `git ls-files` rather than a shell glob, and the same positive control the
 * other scans carry: a scan that silently finds nothing must be
 * distinguishable from a scan that is broken.
 * @returns callers, and the control's own result.
 */
export function manifestBuilderCallers() {
  const tracked = execFileSync('git', ['ls-files', '*.ts'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  const production = tracked.filter(path =>
    !path.startsWith(OWNER)
    && !/(?:^|\/)tests?\//u.test(path)
    && !/\.(?:spec|e2e)\.[cm]?tsx?$/u.test(path))
  const callers = production.filter(path => /\bcreateActionManifest\s*\(/u.test(readFileSync(resolve(REPO_ROOT, path), 'utf8')))
  // The control: the owner's own source must contain the definition, so a zero
  // here means the scan is broken rather than that the callers are gone.
  const ownerDefines = tracked.some(path =>
    path.startsWith(OWNER) && /export function createActionManifest/u.test(readFileSync(resolve(REPO_ROOT, path), 'utf8')))
  return { callers, ownerDefines, scanned: production.length }
}

function main() {
  const { callers, ownerDefines, scanned } = manifestBuilderCallers()
  if (!ownerDefines) {
    console.error('verify-manifest-constructed: the scan found no `export function createActionManifest` in its owning package, so it is broken rather than reporting a real result.')
    process.exit(1)
  }
  if (callers.length === 0) {
    console.error(
      'verify-manifest-constructed: `createActionManifest` has NO production caller.\n'
      + `Scanned ${String(scanned)} tracked non-test files outside ${OWNER}.\n`
      + 'must[0] says the ActionManifest mandates an idempotency key; a manifest nothing builds mandates nothing (BLOCKED-143).',
    )
    process.exit(1)
  }
  console.log(`verify-manifest-constructed: ${String(callers.length)} production caller(s) of createActionManifest — ${callers.join(', ')}.`)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
