/**
 * P1-04 (A) slice 1 red first (lane B; the installer is lane A's): `dsh plugin
 * add` of a hostile tarball, on the shipped CLI. acceptance[0] (「preinstall/
 * postinstall 尝试读取 `$HOME`、访问网络、写 profile 均失败。」), acceptance[1]
 * (「tar path traversal、symlink escape、zip bomb 被拒绝。」) and must[1]'s
 * verification (「以 `--ignore-scripts` 解包并验证 manifest、签名、SBOM、路径穿越。」):
 * a refused tarball exits non-zero, writes nothing outside the package, and
 * leaves the profile's package.json, pnpm-lock.yaml and node_modules byte for
 * byte as they were (acceptance[2]); a benign tarball installs.
 *
 * Each scenario has its own `DSH_HOME` holding a profile made with no bundles
 * that already has one benign plugin, and runs the real `dsh plugin --profile
 * p104 add <tarball>`. The traversal, symlink and zip-bomb tarballs are written
 * here in ustar format; the lifecycle-script package is packed by pnpm; the
 * verification case puts a claim that does not verify beside a benign tarball.
 *
 * Today `dsh plugin add` runs pnpm in the profile directory with no quarantine
 * (apps/cli/src/plugin.ts), so the three acceptance[1] tarballs install — RED.
 * §21.4: written before the installer exists.
 * @module tests/first100/fixtures/P1-04.malicious-tarball.composition
 */

import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync, type Stats } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { initProfile, resolveProfileDir } from '@deepseek-ai/dsh-app-boot'
import { execa } from 'execa'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const binScript = join(repoRoot, 'apps/cli/src/bin.ts')

const PROFILE = 'p104'
/** Deadline for one `dsh plugin` run. */
const COMMAND_TIMEOUT_MS = 180_000
/** The profile entries a refused install must leave byte for byte. */
const PROFILE_STATE = ['package.json', 'pnpm-lock.yaml', 'node_modules']
/** The zip bomb's one file: 256 MiB of zeros, which gzip packs into well under 1 MiB. */
const BOMB_BYTES = 256 * 1024 * 1024

/** One tar entry: a regular file, or a symlink to `target`. */
type TarEntry =
  | { readonly name: string; readonly content: Buffer }
  | { readonly name: string; readonly zeros: number }
  | { readonly name: string; readonly symlinkTo: string }

/** How one refused-or-not add ended. */
interface AddReading {
  readonly exit: number | undefined
  readonly stderr: string
  /** Profile paths whose bytes (or link targets) differ from before the add. */
  readonly changed: readonly string[]
}

const cleanup: string[] = []

/**
 * A fresh harness home holding the profile, made with no bundles.
 * @param tag - part of the directory name.
 * @returns the home.
 */
async function newHome(tag: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), `p1-04-${tag}-`))
  cleanup.push(home)
  initProfile(resolveProfileDir(PROFILE, home), [])
  return home
}

/**
 * Run `dsh plugin --profile p104 add <tarball>`.
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
 * Write one package's sources and pack them with pnpm.
 * @param root - the directory the sources and the tarball go under.
 * @param name - the package name.
 * @param files - further files beside `package.json` and `index.js`.
 * @param extra - further `package.json` fields.
 * @returns the tarball's path.
 */
function packPackage(
  root: string,
  name: string,
  files: Readonly<Record<string, string>> = {},
  extra: Readonly<Record<string, unknown>> = {},
): string {
  const dir = join(root, `src-${name}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', main: './index.js', ...extra }, undefined, 2))
  writeFileSync(join(dir, 'index.js'), `export const name = ${JSON.stringify(name)}\n`)
  for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content)
  const packed = spawnSync('pnpm', ['pack', '--pack-destination', root], { cwd: dir, encoding: 'utf8' })
  if (packed.status !== 0) throw new Error(`pnpm pack failed for ${name}: ${packed.stderr}`)
  return join(root, `${name}-1.0.0.tgz`)
}

/**
 * One ustar header block.
 * @param name - the entry name.
 * @param size - the body's length.
 * @param type - `'0'` for a file, `'2'` for a symlink.
 * @param linkName - the symlink's target.
 * @returns the 512-byte header.
 */
function tarHeader(name: string, size: number, type: '0' | '2', linkName = ''): Buffer {
  const header = Buffer.alloc(512)
  const put = (offset: number, value: string): void => { header.write(value, offset, 'ascii') }
  put(0, name)
  put(100, type === '2' ? '0000777\0' : '0000644\0')
  put(108, '0000000\0')
  put(116, '0000000\0')
  put(124, `${size.toString(8).padStart(11, '0')}\0`)
  put(136, '00000000000\0')
  put(148, '        ')
  put(156, type)
  put(157, linkName)
  put(257, 'ustar\0')
  put(263, '00')
  let sum = 0
  for (const byte of header) sum += byte
  put(148, `${sum.toString(8).padStart(6, '0')}\0 `)
  return header
}

/**
 * Stream a gzipped ustar archive to `path`, so the zip bomb's zeros never sit in memory.
 * @param path - the archive's path.
 * @param entries - the entries, in order.
 */
async function writeTarGz(path: string, entries: readonly TarEntry[]): Promise<void> {
  const gzip = createGzip()
  const done = finished(gzip.pipe(createWriteStream(path)))
  const write = (chunk: Buffer): Promise<void> => new Promise((resolve) => {
    if (gzip.write(chunk)) resolve()
    else gzip.once('drain', resolve)
  })
  for (const entry of entries) {
    if ('symlinkTo' in entry) {
      await write(tarHeader(entry.name, 0, '2', entry.symlinkTo))
      continue
    }
    const size = 'content' in entry ? entry.content.length : entry.zeros
    await write(tarHeader(entry.name, size, '0'))
    if ('content' in entry) await write(entry.content)
    else for (let left = entry.zeros; left > 0; left -= 1024 * 1024) await write(Buffer.alloc(Math.min(left, 1024 * 1024)))
    await write(Buffer.alloc((512 - (size % 512)) % 512))
  }
  await write(Buffer.alloc(1024))
  gzip.end()
  await done
}

/**
 * The two files every hand-written tarball's package carries.
 * @param name - the package name.
 * @returns the `package.json` and `index.js` entries.
 */
function packageEntries(name: string): TarEntry[] {
  return [
    { name: 'package/package.json', content: Buffer.from(JSON.stringify({ name, version: '1.0.0', type: 'module', main: './index.js' })) },
    { name: 'package/index.js', content: Buffer.from(`export const name = ${JSON.stringify(name)}\n`) },
  ]
}

/**
 * Every file's content digest and every symlink's target under the profile's package state.
 * @param profileDir - the profile directory.
 * @returns path → `sha256:<hex>` or `link:<target>`.
 */
function snapshot(profileDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (relativePath: string): void => {
    const path = join(profileDir, relativePath)
    let stats: Stats
    try {
      stats = lstatSync(path)
    } catch {
      // Absent: a path that does not exist contributes nothing to the snapshot.
      return
    }
    if (stats.isSymbolicLink()) out[relativePath] = `link:${readlinkSync(path)}`
    else if (stats.isDirectory()) for (const child of readdirSync(path).sort()) walk(join(relativePath, child))
    else out[relativePath] = `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
  }
  for (const entry of PROFILE_STATE) walk(entry)
  return out
}

/**
 * The profile paths whose recorded value differs between two snapshots.
 * @param before - the snapshot before the add.
 * @param after - the snapshot after it.
 * @returns the changed, added or removed paths.
 */
function changedPaths(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys].filter(key => before[key] !== after[key]).sort()
}

/**
 * A scenario's home with one benign plugin installed, ready for the add under test.
 * @param tag - part of the directory name.
 * @returns the home, its profile directory and the scenario's scratch directory.
 */
async function primedHome(tag: string): Promise<{ readonly home: string; readonly profileDir: string; readonly scratch: string }> {
  const home = await newHome(tag)
  const scratch = join(home, 'scratch')
  mkdirSync(scratch, { recursive: true })
  const base = await add(home, packPackage(scratch, `p104-base-${tag}`))
  if (base.exitCode !== 0) throw new Error(`installing the benign base plugin failed: ${base.stderr.slice(-800)}`)
  return { home, profileDir: resolveProfileDir(PROFILE, home), scratch }
}

/**
 * Add one tarball to a primed profile and read what the add changed there.
 * @param primed - the scenario's home and profile.
 * @param tarball - the tarball under test.
 * @param env - further environment.
 * @returns the reading.
 */
async function addAndRead(
  primed: { readonly home: string; readonly profileDir: string },
  tarball: string,
  env: Readonly<Record<string, string>> = {},
): Promise<AddReading> {
  const before = snapshot(primed.profileDir)
  const ran = await add(primed.home, tarball, env)
  return { exit: ran.exitCode, stderr: ran.stderr.slice(-800), changed: changedPaths(before, snapshot(primed.profileDir)) }
}

/**
 * Every file named `name` under `root`.
 * @param root - where to look.
 * @param name - the file name.
 * @returns the paths found.
 */
function filesNamed(root: string, name: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    let children: string[]
    try {
      children = readdirSync(dir)
    } catch {
      // Unreadable or vanished: nothing below it can be listed, so nothing is counted.
      return
    }
    for (const child of children) {
      const path = join(dir, child)
      const stats = lstatSync(path)
      if (stats.isDirectory() && !stats.isSymbolicLink()) walk(path)
      else if (child === name) found.push(path)
    }
  }
  walk(root)
  return found
}

/** What every scenario left, read by the cases. */
interface Readings {
  readonly control: AddReading & { readonly present: boolean; readonly dependency: boolean }
  readonly scripts: AddReading & { readonly ran: readonly string[]; readonly networkHits: readonly string[] }
  readonly traversal: AddReading & { readonly escaped: readonly string[] }
  readonly symlink: AddReading & { readonly escaped: boolean }
  readonly bomb: AddReading & { readonly bombBytesOnDisk: readonly string[] }
  readonly unverified: AddReading
}

let readings: Readings | undefined
let setupError: string | undefined

beforeAll(async () => {
  try {
    // A benign plugin installs and is recorded (the control every refusal is read against).
    const controlHome = await primedHome('control')
    const control = await addAndRead(controlHome, packPackage(controlHome.scratch, 'p104-benign'))
    const controlManifest = JSON.parse(readFileSync(join(controlHome.profileDir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }

    // acceptance[0]: each lifecycle script tries to read $HOME, reach the network and write the profile.
    const scriptsHome = await primedHome('scripts')
    const markers = join(scriptsHome.home, 'markers')
    mkdirSync(markers, { recursive: true })
    const networkHits: string[] = []
    const server: Server = createServer((request, response) => {
      networkHits.push(request.url ?? '')
      response.end('ok')
    })
    await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const lifecycle = [
      "import { readdirSync, writeFileSync } from 'node:fs'",
      "import { get } from 'node:http'",
      "import { join } from 'node:path'",
      'const phase = process.argv[2]',
      `try { writeFileSync(join(${JSON.stringify(markers)}, phase + '-home'), String(readdirSync(process.env.HOME ?? '/').length)) } catch {}`,
      `try { writeFileSync(join(${JSON.stringify(scriptsHome.profileDir)}, 'p104-written-by-' + phase), phase) } catch {}`,
      `await new Promise((resolve) => { get('http://127.0.0.1:${String(port)}/' + phase, { agent: false }, (res) => { res.resume(); resolve() }).on('error', resolve) })`,
    ].join('\n')
    const scriptsTarball = packPackage(scriptsHome.scratch, 'p104-scripts', { 'lifecycle.js': lifecycle }, {
      scripts: { preinstall: 'node ./lifecycle.js preinstall', install: 'node ./lifecycle.js install', postinstall: 'node ./lifecycle.js postinstall' },
    })
    const scripts = await addAndRead(scriptsHome, scriptsTarball)
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    const ran = [
      ...readdirSync(markers),
      ...readdirSync(scriptsHome.profileDir).filter(name => name.startsWith('p104-written-by-')),
    ].sort()

    // acceptance[1]: an entry whose name climbs out of the package directory.
    const traversalHome = await primedHome('traversal')
    const escapeName = `p104-escape-${randomBytes(6).toString('hex')}.txt`
    const traversalTarball = join(traversalHome.scratch, 'p104-traversal-1.0.0.tgz')
    await writeTarGz(traversalTarball, [
      ...packageEntries('p104-traversal'),
      { name: `package/../../../../../../${escapeName}`, content: Buffer.from('escaped') },
    ])
    const traversal = await addAndRead(traversalHome, traversalTarball)
    const escaped = [
      // A copy inside an installed copy of the package itself has not escaped it.
      ...filesNamed(traversalHome.home, escapeName).filter(path => !path.split(sep).includes('p104-traversal')),
      ...readdirSync(dirname(traversalHome.home)).filter(name => name === escapeName),
    ]

    // acceptance[1]: a symlink that points outside, then a file written through it.
    const symlinkHome = await primedHome('symlink')
    const outside = join(symlinkHome.home, 'outside')
    mkdirSync(outside, { recursive: true })
    const symlinkTarball = join(symlinkHome.scratch, 'p104-symlink-1.0.0.tgz')
    await writeTarGz(symlinkTarball, [
      ...packageEntries('p104-symlink'),
      { name: 'package/escape', symlinkTo: outside },
      { name: 'package/escape/pwned.txt', content: Buffer.from('pwned') },
    ])
    const symlink = await addAndRead(symlinkHome, symlinkTarball)

    // acceptance[1]: a zip bomb.
    const bombHome = await primedHome('bomb')
    const bombTarball = join(bombHome.scratch, 'p104-bomb-1.0.0.tgz')
    await writeTarGz(bombTarball, [...packageEntries('p104-bomb'), { name: 'package/bomb.bin', zeros: BOMB_BYTES }])
    const bomb = await addAndRead(bombHome, bombTarball)
    const bombBytesOnDisk = filesNamed(bombHome.profileDir, 'bomb.bin')

    // must[1]: a claim beside the tarball that does not verify.
    const unverifiedHome = await primedHome('unverified')
    const unverifiedTarball = packPackage(unverifiedHome.scratch, 'p104-unverified')
    writeFileSync(`${unverifiedTarball}.provenance.json`, JSON.stringify({ claim: {}, sbom: {} }))
    const unverified = await addAndRead(unverifiedHome, unverifiedTarball)

    readings = {
      control: {
        ...control,
        present: existsSync(join(controlHome.profileDir, 'node_modules', 'p104-benign', 'package.json')),
        dependency: controlManifest.dependencies?.['p104-benign'] !== undefined,
      },
      scripts: { ...scripts, ran, networkHits },
      traversal: { ...traversal, escaped },
      symlink: { ...symlink, escaped: existsSync(join(outside, 'pwned.txt')) },
      bomb: { ...bomb, bombBytesOnDisk },
      unverified,
    }
  } catch (error: unknown) {
    setupError = error instanceof Error ? error.message : String(error)
  }
}, 14 * COMMAND_TIMEOUT_MS)

afterAll(async () => {
  for (const root of cleanup) await rm(root, { recursive: true, force: true })
})

/** The scenarios' readings, or the reason there are none. */
function readingsOf(): Readings {
  if (readings === undefined) throw new Error(setupError ?? 'no readings')
  return readings
}

describe('P1-04 (A) slice 1 (lane B red first for the installer): dsh plugin add refuses a hostile tarball and leaves the profile byte for byte', () => {
  it('control: a benign tarball installs and is recorded as a dependency', () => {
    const { control } = readingsOf()
    expect({ exit: control.exit, present: control.present, dependency: control.dependency }, JSON.stringify(control))
      .toEqual({ exit: 0, present: true, dependency: true })
  })

  it('acceptance[0]: no lifecycle script reads $HOME, reaches the network or writes the profile', () => {
    const { scripts } = readingsOf()
    expect({ ran: scripts.ran, networkHits: scripts.networkHits }, JSON.stringify(scripts)).toEqual({ ran: [], networkHits: [] })
  })

  it('acceptance[1]: a tarball entry that climbs out of its package is refused, nothing escapes and the profile is unchanged (today it installs — RED)', () => {
    const { traversal } = readingsOf()
    expect({ refused: traversal.exit !== 0, escaped: traversal.escaped, changed: traversal.changed }, JSON.stringify(traversal))
      .toEqual({ refused: true, escaped: [], changed: [] })
  })

  it('acceptance[1]: a symlink that points out of the package is refused, nothing is written through it and the profile is unchanged (today it installs — RED)', () => {
    const { symlink } = readingsOf()
    expect({ refused: symlink.exit !== 0, escaped: symlink.escaped, changed: symlink.changed }, JSON.stringify(symlink))
      .toEqual({ refused: true, escaped: false, changed: [] })
  })

  it('acceptance[1]: a zip bomb (256 MiB of zeros in under 1 MiB) is refused, not unpacked into the profile, and the profile is unchanged (today it installs — RED)', () => {
    const { bomb } = readingsOf()
    expect({ refused: bomb.exit !== 0, bombBytesOnDisk: bomb.bombBytesOnDisk, changed: bomb.changed }, JSON.stringify(bomb))
      .toEqual({ refused: true, bombBytesOnDisk: [], changed: [] })
  })

  it('must[1]: a tarball whose provenance claim does not verify is refused and the profile is unchanged', () => {
    const { unverified } = readingsOf()
    expect({ refused: unverified.exit !== 0, changed: unverified.changed }, JSON.stringify(unverified))
      .toEqual({ refused: true, changed: [] })
  })
})
