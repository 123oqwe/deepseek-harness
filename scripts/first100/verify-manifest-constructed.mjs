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
 * **Construction through the façade counts (§12.39).** §12.33 routed both
 * dispatch paths through `appendManifestThenGate`, which constructs the
 * manifest inside the owning package — so a scan for direct
 * `createActionManifest` callers went to zero while the manifest was being
 * built on every native and code-mode dispatch. Read literally the gate was
 * right; read for its purpose it was wrong, and the purpose is what BLOCKED-143
 * is about. Either entry point counts, because calling either one is what makes
 * a real record exist on a production path.
 *
 * **Construction through a shared helper counts (B-645).** B-615 moved the
 * code-mode path's construction into `appendManifestAndDecide`, an exported
 * helper the public `ToolRuntime.execute` seam calls too, so the scan found the
 * helper's file and neither dispatch path. The scan now follows every exported
 * top-level function whose body calls an entry point, to a fixed point, and
 * counts its callers. A file whose only calls sit inside such helpers is
 * reported as a helper module rather than a dispatch path. A helper that calls
 * `createActionManifest` without the façade is followed the same way.
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
 * The entry points that construct a manifest. Calling EITHER builds the record:
 * the façade's whole job is to construct it and then gate on it, so a caller
 * reaching the façade has built one just as surely as a direct caller.
 */
const BUILDERS = ['createActionManifest', 'appendManifestThenGate']

/**
 * A pattern matching a call to any of `names`.
 * @param {readonly string[]} names - the function names.
 * @returns {RegExp} the pattern.
 */
function callTo(names) {
  return new RegExp(`\\b(?:${names.join('|')})\\s*\\(`, 'u')
}

/**
 * The text of each exported top-level function in one source, by name. A
 * declaration starts at column 0 and its body closes with a `}` at column 0,
 * which is how every tracked file is formatted.
 * @param {string} source - one file's text.
 * @returns {Map<string, string>} each function's text, declaration to closing brace.
 */
function exportedFunctions(source) {
  const lines = source.split('\n')
  const found = new Map()
  lines.forEach((line, start) => {
    const name = /^export (?:async )?function\s+(\w+)/u.exec(line)?.[1]
    if (name === undefined) return
    const end = lines.findIndex((text, index) => index > start && text === '}')
    found.set(name, lines.slice(start, end === -1 ? undefined : end + 1).join('\n'))
  })
  return found
}

/**
 * Production files that construct a manifest, directly or through a helper.
 *
 * `git ls-files` rather than a shell glob, and the same positive control the
 * other scans carry: a scan that silently finds nothing must be
 * distinguishable from a scan that is broken.
 * @returns callers, the helpers followed, and the control's own result.
 */
export function manifestBuilderCallers() {
  const tracked = execFileSync('git', ['ls-files', '*.ts'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
  const production = tracked.filter(path =>
    !path.startsWith(OWNER)
    && !/(?:^|\/)tests?\//u.test(path)
    && !/\.(?:spec|e2e)\.[cm]?tsx?$/u.test(path))
  const sources = new Map(production.map(path => [path, readFileSync(resolve(REPO_ROOT, path), 'utf8')]))
  // Follow exported helpers to a fixed point: a function that calls an entry
  // point builds a manifest for whoever calls it, so it becomes one.
  const entryPoints = [...BUILDERS]
  const helpers = []
  for (let grew = true; grew;) {
    grew = false
    for (const [path, source] of sources) {
      if (!callTo(entryPoints).test(source)) continue
      for (const [name, text] of exportedFunctions(source)) {
        const reaches = entryPoints.filter(entry => entry !== name && callTo([entry]).test(text))
        if (entryPoints.includes(name) || reaches.length === 0) continue
        helpers.push({ file: path, name, reaches })
        entryPoints.push(name)
        grew = true
      }
    }
  }
  // A dispatch path calls an entry point somewhere other than inside the
  // helpers its own file exports.
  const calls = callTo(entryPoints)
  const callers = production.filter((path) => {
    let rest = sources.get(path)
    if (!calls.test(rest)) return false
    const own = new Set(helpers.filter(helper => helper.file === path).map(helper => helper.name))
    for (const [name, text] of exportedFunctions(rest)) {
      if (own.has(name)) rest = rest.replace(text, '')
    }
    return calls.test(rest)
  })
  // The control: the owner's own source must define EVERY builder this scan
  // accepts, so a zero means the scan is broken rather than that the callers
  // are gone. Both are checked, not just one — a renamed façade would
  // otherwise leave the gate quietly counting a name nothing declares.
  const ownerSources = tracked.filter(path => path.startsWith(OWNER))
    .map(path => readFileSync(resolve(REPO_ROOT, path), 'utf8'))
  const ownerDefines = BUILDERS.every(builder =>
    ownerSources.some(source => new RegExp(`export function ${builder}`, 'u').test(source)))
  return { callers, helpers, ownerDefines, scanned: production.length }
}

function main() {
  const { callers, helpers, ownerDefines, scanned } = manifestBuilderCallers()
  if (!ownerDefines) {
    console.error(`verify-manifest-constructed: the scan did not find every builder (${BUILDERS.join(', ')}) declared in ${OWNER}, so it is broken rather than reporting a real result.`)
    process.exit(1)
  }
  if (callers.length === 0) {
    console.error(
      `verify-manifest-constructed: no production caller of ${BUILDERS.join(' or ')}.\n`
      + `Scanned ${String(scanned)} tracked non-test files outside ${OWNER}.\n`
      + 'must[0] says the ActionManifest mandates an idempotency key; a manifest nothing builds mandates nothing (BLOCKED-143).',
    )
    process.exit(1)
  }
  console.log(`verify-manifest-constructed: ${String(callers.length)} production caller(s) of ${BUILDERS.join(' or ')} — ${callers.join(', ')}.`)
  for (const helper of helpers) {
    console.log(`  through ${helper.file} ${helper.name}, which calls ${helper.reaches.join(', ')}`)
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main()
