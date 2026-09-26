/**
 * A-468 under P1-04: `dsh plugin add` installs through a quarantine and runs
 * no lifecycle script on the host. must[1] (「以 `--ignore-scripts` 解包并验证
 * manifest、签名、SBOM、路径穿越。」), must[4] (「失败清理且不修改
 * profile/lock。」), acceptance[0] (「preinstall/postinstall 尝试读取
 * `$HOME`、访问网络、写 profile 均失败。」), acceptance[1] (「tar path
 * traversal、symlink escape、zip bomb 被拒绝。」) and acceptance[2] (「安装失败后
 * profile、lock、node_modules 可恢复到字节级原状态。」).
 *
 * Each scenario runs the real `dsh plugin --profile a468 add <tarball>`
 * against its own `DSH_HOME` holding a profile made with no bundles, as
 * `plugin-migration-cli-crash.spec.ts` does. The failed add of acceptance[2]
 * is made by a `pnpm` shim first on `PATH` that runs the real pnpm and then
 * exits 1, so the package manager fails after it has written. The traversal
 * tarball is written here in ustar format, with one entry whose name climbs
 * out of the package directory.
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')

const PROFILE = 'a468'
/** Deadline for one `dsh plugin` run. */
const COMMAND_TIMEOUT_MS = 120_000
/** The profile entries acceptance[2] requires back byte for byte. */
const PROFILE_STATE = ['package.json', 'pnpm-lock.yaml', 'node_modules']
/** The lifecycle scripts acceptance[0] names, and the one between them. */
const LIFECYCLE = ['preinstall', 'install', 'postinstall'] as const

/** What the scenarios left, read by the cases. */
interface Readings {
  readonly control: { readonly exit: number | undefined; readonly present: boolean; readonly dependency: boolean; readonly stderr: string }
  readonly failedAdd: { readonly exit: number | undefined; readonly changed: readonly string[]; readonly stderr: string }
  readonly scripts: { readonly exit: number | undefined; readonly ran: readonly string[]; readonly stderr: string }
  readonly traversal: { readonly exit: number | undefined; readonly escaped: readonly string[]; readonly stderr: string }
}

let readings: Readings | undefined
let failure: string | undefined
const cleanup: string[] = []

/**
 * Write one package's sources and pack them with pnpm.
 * @param root - the directory the sources and the tarball go under.
 * @param name - the package name.
 * @param extra - further `package.json` fields.
 * @returns the tarball's path.
 */
function packPackage(root: string, name: string, extra: Readonly<Record<string, unknown>> = {}): string {
  const dir = join(root, `src-${name}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: './index.js', ...extra }, undefined, 2))
  writeFileSync(join(dir, 'index.js'), `export const name = ${JSON.stringify(name)}\n`)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed for ${name}: ${packed.stderr}`)
  return join(root, `${name}-1.0.0.tgz`)
}

/**
 * A gzipped ustar archive of regular files.
 * @param entries - each file's name inside the archive and its text.
 * @returns the archive bytes.
 */
function tarGz(entries: readonly { readonly name: string; readonly content: string }[]): Buffer {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const body = Buffer.from(entry.content, 'utf8')
    const header = Buffer.alloc(512)
    const put = (offset: number, text: string): void => { header.write(text, offset, 'ascii') }
    put(0, entry.name)
    put(100, '0000644\0')
    put(108, '0000000\0')
    put(116, '0000000\0')
    put(124, `${body.length.toString(8).padStart(11, '0')}\0`)
    put(136, '00000000000\0')
    put(148, '        ')
    put(156, '0')
    put(257, 'ustar\0')
    put(263, '00')
    let sum = 0
    for (const byte of header) sum += byte
    put(148, `${sum.toString(8).padStart(6, '0')}\0 `)
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512))
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

/**
 * A fresh harness home holding the profile, made with no bundles.
 * @param tag - part of the directory name.
 * @returns the home.
 */
async function newHome(tag: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), `p1-04-quarantine-${tag}-`))
  cleanup.push(home)
  initProfile(resolveProfileDir(PROFILE, home), [])
  return home
}

/**
 * Run `dsh plugin --profile a468 add <tarball>`.
 * @param home - the scenario's harness home.
 * @param tarball - the tarball to add.
 * @param env - further environment.
 * @returns the finished process.
 */
function add(home: string, tarball: string, env: Readonly<Record<string, string>> = {}) {
  return execa(process.execPath, ['--import', 'tsx/esm', binScript, 'plugin', '--profile', PROFILE, 'add', tarball], {
    cwd: repoRoot,
    env: { DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', ...env },
    timeout: COMMAND_TIMEOUT_MS,
    reject: false,
  })
}

/**
 * Every file's content digest and every symlink's target under the profile's package state.
 * @param profileDir - the profile directory.
 * @returns path → `sha256:<hex>` or `link:<target>`, for `package.json`, `pnpm-lock.yaml` and `node_modules`.
 */
function snapshot(profileDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (relativePath: string): void => {
    const path = join(profileDir, relativePath)
    if (!existsSync(path) && !isLink(path)) return
    const stats = lstatSync(path)
    if (stats.isSymbolicLink()) out[relativePath] = `link:${readlinkSync(path)}`
    else if (stats.isDirectory()) for (const name of readdirSync(path)) walk(join(relativePath, name))
    else out[relativePath] = `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
  }
  for (const entry of PROFILE_STATE) walk(entry)
  return out
}

/**
 * Whether a path is a symlink, dangling or not.
 * @param path - the path.
 * @returns whether `lstat` reports a symlink.
 */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    // Absent: neither a link nor anything else to read.
    return false
  }
}

/**
 * Every path under a directory whose last segment is `name`, not following symlinks.
 * @param root - the directory.
 * @param name - the file name.
 * @returns the paths.
 */
function findNamed(root: string, name: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.name === name) found.push(path)
      if (entry.isDirectory()) walk(path)
    }
  }
  walk(root)
  return found
}

beforeAll(async () => {
  try {
    const packRoot = await mkdtemp(join(tmpdir(), 'p1-04-quarantine-pack-'))
    cleanup.push(packRoot)

    // Control, then acceptance[2] on the same profile.
    const home = await newHome('failed-add')
    const profileDir = resolveProfileDir(PROFILE, home)
    const installed = await add(home, packPackage(packRoot, 'a468-good'))
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { readonly dependencies?: Record<string, string> }
    const control = {
      exit: installed.exitCode,
      present: existsSync(join(profileDir, 'node_modules', 'a468-good', 'package.json')),
      dependency: manifest.dependencies?.['a468-good'] !== undefined,
      stderr: installed.stderr.slice(-600),
    }
    const realPnpm = spawnSync('sh', ['-c', 'command -v pnpm'], { encoding: 'utf8' }).stdout.trim()
    if (realPnpm === '') throw new Error('pnpm is not on PATH')
    const shimDir = join(packRoot, 'shim')
    mkdirSync(shimDir)
    writeFileSync(join(shimDir, 'pnpm'), [
      '#!/bin/sh',
      `"${realPnpm}" "$@"`,
      'status=$?',
      'if [ "$status" -ne 0 ]; then exit "$status"; fi',
      'echo "a468 shim: pnpm finished, reporting a failure" >&2',
      'exit 1',
      '',
    ].join('\n'))
    chmodSync(join(shimDir, 'pnpm'), 0o755)
    const second = packPackage(packRoot, 'a468-second')
    const before = snapshot(profileDir)
    const failed = await add(home, second, { PATH: `${shimDir}:${process.env.PATH ?? ''}` })
    const after = snapshot(profileDir)
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => before[key] !== after[key]).sort()

    // acceptance[0]: each lifecycle script writes one marker outside the profile and one inside it.
    const scriptsHome = await newHome('scripts')
    const scriptsProfile = resolveProfileDir(PROFILE, scriptsHome)
    const markers = LIFECYCLE.flatMap(phase => [join(packRoot, `marker-${phase}`), join(scriptsProfile, `marker-${phase}`)])
    const write = (path: string): string => `node -e "require('node:fs').writeFileSync(${JSON.stringify(path).replaceAll('"', '\'')}, 'ran')"`
    const scripts = Object.fromEntries(LIFECYCLE.map(phase => [phase, `${write(join(packRoot, `marker-${phase}`))} && ${write(join(scriptsProfile, `marker-${phase}`))}`]))
    const withScripts = await add(scriptsHome, packPackage(packRoot, 'a468-scripts', { scripts }))

    // acceptance[1]: an entry that climbs five levels out of the package directory lands in the profile directory.
    const traversalHome = await newHome('traversal')
    const escapeName = `a468-escape-${randomBytes(6).toString('hex')}.txt`
    const traversalTarball = join(packRoot, 'a468-traversal-1.0.0.tgz')
    writeFileSync(traversalTarball, tarGz([
      { name: 'package/package.json', content: JSON.stringify({ name: 'a468-traversal', version: '1.0.0', type: 'module', main: './index.js' }) },
      { name: 'package/index.js', content: 'export const name = \'a468-traversal\'\n' },
      { name: `package/../../../../../${escapeName}`, content: 'escaped\n' },
    ]))
    const traversal = await add(traversalHome, traversalTarball)
    // A file inside an installed copy of the package (a `node_modules/a468-traversal` directory) has not escaped it.
    const insidePackage = (path: string): boolean => path.split(sep).some((segment, index, all) => segment === 'a468-traversal' && all[index - 1] === 'node_modules')
    const escaped = [
      ...findNamed(traversalHome, escapeName),
      ...existsSync(join(dirname(traversalHome), escapeName)) ? [join(dirname(traversalHome), escapeName)] : [],
    ].filter(path => !insidePackage(path))

    readings = {
      control,
      failedAdd: { exit: failed.exitCode, changed, stderr: failed.stderr.slice(-600) },
      scripts: { exit: withScripts.exitCode, ran: markers.filter(marker => existsSync(marker)), stderr: withScripts.stderr.slice(-600) },
      traversal: { exit: traversal.exitCode, escaped, stderr: traversal.stderr.slice(-600) },
    }
  } catch (error: unknown) {
    failure = error instanceof Error ? error.message : String(error)
  }
}, 6 * COMMAND_TIMEOUT_MS)

afterAll(async () => {
  for (const dir of cleanup) await rm(dir, { recursive: true, force: true })
})

/**
 * The scenarios' readings, or the reason there are none.
 * @returns the readings.
 */
function read(): Readings {
  if (readings === undefined) throw new Error(failure ?? 'the scenarios left no readings')
  return readings
}

describe.skipIf(process.platform === 'win32')('P1-04: dsh plugin add installs through a quarantine and runs no lifecycle script on the host', () => {
  it('control: adding a well-formed local tarball succeeds and the package lands in the profile', () => {
    const { control } = read()
    expect({ exit: control.exit, present: control.present, dependency: control.dependency }, JSON.stringify(control))
      .toEqual({ exit: 0, present: true, dependency: true })
  })

  it('acceptance[2]: an add whose package manager fails after writing leaves package.json, the lockfile and node_modules byte-identical', () => {
    const { failedAdd } = read()
    expect({ failed: failedAdd.exit !== 0, changed: failedAdd.changed.slice(0, 20) }, JSON.stringify(failedAdd))
      .toEqual({ failed: true, changed: [] })
  })

  it('acceptance[0]: the added package\'s preinstall, install and postinstall scripts do not run on the host', () => {
    const { scripts } = read()
    expect(scripts.ran, JSON.stringify(scripts)).toEqual([])
  })

  it('acceptance[1]: a tarball with an entry that climbs out of the package directory is refused and writes nothing outside it', () => {
    const { traversal } = read()
    expect({ refused: traversal.exit !== 0, escaped: traversal.escaped }, JSON.stringify(traversal)).toEqual({ refused: true, escaped: [] })
  })
})
