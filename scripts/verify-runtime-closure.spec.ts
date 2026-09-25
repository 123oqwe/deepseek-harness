import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyCarrierProfiles, verifyDeployClosurePeers, verifyRuntimeClosure } from './verify-runtime-closure.ts'

const roots: string[] = []

function fixture(files: Record<string, string | Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-runtime-closure-'))
  roots.push(root)
  for (const [relative, value] of Object.entries(files)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
  }
  return root
}

const platforms = {
  'linux-x64': { tag: 'manylinux_2_28_x86_64', executable: 'runtime-linux-x64' },
  'linux-arm64': { tag: 'manylinux_2_28_aarch64', executable: 'runtime-linux-arm64' },
  'macos-arm64': { tag: 'macosx_14_0_arm64', executable: 'runtime-macos-arm64' },
  'macos-x64': { tag: 'macosx_14_0_x86_64', executable: 'runtime-macos-x64' },
  'win-x64': { tag: 'win_amd64', executable: 'runtime-win-x64.exe' },
}

function workspace(root: string, name: string, manifest: Record<string, unknown>): void {
  const packageName = name.replace('@scope/', '')
  const path = join(root, 'packages/core', packageName, 'package.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ name, ...manifest }, null, 2)}\n`)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('verifyRuntimeClosure', () => {
  it('requires only plugins active for each published target', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/shared': 'workspace:^' } },
      'python/sdk-runtime/platforms.json': platforms,
      'packages/preset/agent-presets/presets/standard/agent.cordis.yml': `
- id: tools
  name: cordis:group
  group: true
  config:
    - id: shared
      name: '@scope/shared'
    - id: linux
      name: '@scope/linux'
      disabled: !!js process.platform !== 'linux'
    - id: macos
      name: '@scope/macos'
      disabled: !!js process.platform !== 'darwin'
    - id: windows
      name: '@scope/windows'
      disabled: !!js process.platform !== 'win32'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.presetCount).toBe(1)
    expect(result.failures).toEqual([
      'standard preset -> @scope/linux (linux-arm64, linux-x64)',
      'standard preset -> @scope/macos (macos-arm64, macos-x64)',
      'standard preset -> @scope/windows (win-x64)',
    ])
  })

  it('treats an unsupported disabled expression as active on every target', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: {} },
      'python/sdk-runtime/platforms.json': platforms,
      'packages/preset/agent-presets/presets/standard/agent.cordis.yml': `
- id: conditional
  name: '@scope/conditional'
  disabled: !!js process.env.DSH_DISABLE_CONDITIONAL === '1'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'standard preset -> @scope/conditional (linux-arm64, linux-x64, macos-arm64, macos-x64, win-x64)',
    ])
  })

  it('does not interpret an ordinary plugin array config as nested Loader entries', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/plugin': 'workspace:^' } },
      'python/sdk-runtime/platforms.json': platforms,
      'packages/preset/agent-presets/presets/standard/agent.cordis.yml': `
- id: plugin
  name: '@scope/plugin'
  config:
    - name: '@scope/config-value'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([])
  })

  it('requires preset plugins to be linked from the workspace', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/plugin': '1.2.3' } },
      'python/sdk-runtime/platforms.json': platforms,
      'packages/preset/agent-presets/presets/standard/agent.cordis.yml': `
- id: plugin
  name: '@scope/plugin'
`,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'standard preset -> @scope/plugin [runtime dependency is "1.2.3"; expected workspace:] (linux-arm64, linux-x64, macos-arm64, macos-x64, win-x64)',
    ])
  })

  it('fails when no shipped preset is discovered', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: {} },
      'python/sdk-runtime/platforms.json': platforms,
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.presetCount).toBe(0)
    expect(result.failures).toEqual([
      'no agent presets matched packages/preset/agent-presets/presets/*/agent.cordis.yml',
    ])
  })

  it('fails when the runtime platform manifest has no targets', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: {} },
      'python/sdk-runtime/platforms.json': {},
      'packages/preset/agent-presets/presets/standard/agent.cordis.yml': '[]\n',
    })

    const result = await verifyRuntimeClosure(root)

    expect(result.failures).toEqual([
      'python/sdk-runtime/platforms.json defines no runtime targets',
    ])
  })

  it('retains the required workspace-peer closure check', async () => {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies: { '@scope/root': 'workspace:^' } },
      'python/sdk-runtime/platforms.json': platforms,
      'packages/preset/agent-presets/presets/minimal/agent.cordis.yml': '[]\n',
    })
    workspace(root, '@scope/root', {
      peerDependencies: { '@scope/required': 'workspace:^', '@scope/optional': 'workspace:^' },
      peerDependenciesMeta: { '@scope/optional': { optional: true } },
    })
    workspace(root, '@scope/required', {})
    workspace(root, '@scope/optional', {})

    const result = await verifyRuntimeClosure(root)

    expect(result.workspacePackageCount).toBe(1)
    expect(result.failures).toEqual(['runtime -> @scope/root -> @scope/required'])
  })
})

describe('verifyCarrierProfiles', () => {
  const PROFILES = "export const PROFILE_TEMPLATES = {\n  sdk: { bundles: ['@scope/base'] },\n  web: { bundles: ['@scope/web-app'] },\n}\n"

  /** A carrier whose sdk profile loads a CLI, one bundle and its plugin row, beside a web profile it does not run. */
  function carrier(dependencies: Record<string, string>, profiles = PROFILES): string {
    const root = fixture({
      'python/sdk-runtime/package.json': { name: 'runtime', dependencies },
      'python/sdk-runtime/platforms.json': platforms,
      'python/sdk-runtime/runtime-bootstrap.mjs': "const { runCli } = await import('@scope/cli/lib/bin.js')\n",
      'packages/boot/app-boot/src/profile.ts': profiles,
      'apps/cli/package.json': { name: '@scope/cli' },
      'apps/cli/src/bin.ts': "import { boot } from '@scope/boot'\nimport type { Shape } from '@scope/types-only'\nexport const run = (shape: Shape): void => boot(shape)\n",
      'packages/core/base/cordis.patch.yml': "- insert:\n    - id: tool\n      name: '@scope/tool'\n    - id: off\n      name: '@scope/off'\n      disabled: true\n",
      'packages/core/tool/src/index.ts': "import { help } from '@scope/helper'\nexport const tool = help\n",
      'packages/core/web-app/cordis.patch.yml': "- insert:\n    - id: page\n      name: '@scope/web-only'\n",
    })
    workspace(root, '@scope/base', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
    workspace(root, '@scope/web-app', { dsh: { bundle: { patch: './cordis.patch.yml' } } })
    workspace(root, '@scope/tool', {
      peerDependencies: { '@scope/peer': 'workspace:^', '@scope/optional-peer': 'workspace:^' },
      peerDependenciesMeta: { '@scope/optional-peer': { optional: true } },
    })
    for (const name of ['@scope/boot', '@scope/types-only', '@scope/helper', '@scope/peer', '@scope/optional-peer', '@scope/off', '@scope/web-only']) {
      workspace(root, name, {})
    }
    return root
  }

  const DECLARED = Object.fromEntries(
    ['@scope/cli', '@scope/base', '@scope/tool', '@scope/peer', '@scope/boot', '@scope/helper'].map(name => [name, 'workspace:^']),
  )

  it('requires each package a carrier profile loads at start: bundles, enabled plugin rows, value imports and workspace peers', async () => {
    const result = await verifyCarrierProfiles(carrier({ '@scope/cli': 'workspace:^' }))

    expect(result.profiles).toEqual(['sdk'])
    expect(result.failures).toEqual([
      'runtime -> sdk profile bundle -> @scope/base (sdk)',
      'runtime -> sdk profile plugin row -> @scope/tool (sdk)',
      'runtime -> sdk profile plugin row -> @scope/tool -> @scope/peer (sdk)',
      'runtime -> sdk profile runtime-bootstrap.mjs -> @scope/cli -> @scope/boot (sdk)',
      'runtime -> sdk profile plugin row -> @scope/tool -> @scope/helper (sdk)',
    ])
  })

  it('never requires a disabled row, a type-only import, an optional peer or an excluded profile', async () => {
    const result = await verifyCarrierProfiles(carrier(DECLARED))

    expect(result.failures).toEqual([])
    expect(result.startPackageCount).toBe(5)
    expect(result.excludedProfiles).toEqual(['web, because its client packages import packages they do not declare as runtime dependencies'])
  })

  it('fails when an excluded profile is no longer a template', async () => {
    const result = await verifyCarrierProfiles(carrier(DECLARED, "export const PROFILE_TEMPLATES = {\n  sdk: { bundles: ['@scope/base'] },\n}\n"))

    expect(result.failures).toEqual(['packages/boot/app-boot/src/profile.ts has no profile web, which the carrier exclusions name'])
  })
})

describe('verifyDeployClosurePeers', () => {
  const LIB_A = '      lib-a:\n        specifier: ^1.0.0\n        version: 1.0.0(peer-x@2.0.0)\n'
  const PEER_X = '      peer-x:\n        specifier: ^2.0.0\n        version: 2.0.0\n'

  /** A lockfile whose runtime importer links a CLI importer that depends on `cliDependencies`. */
  function lockfile(cliDependencies: string): string {
    return [
      "lockfileVersion: '9.0'",
      'importers:',
      '  python/sdk-runtime:',
      '    dependencies:',
      "      '@scope/cli':",
      '        specifier: workspace:^',
      '        version: link:../../apps/cli',
      '  apps/cli:',
      '    dependencies:',
      cliDependencies.trimEnd(),
      'packages:',
      '  lib-a@1.0.0:',
      '    resolution: {integrity: sha512-a}',
      '    peerDependencies:',
      '      peer-x: ^2.0.0',
      '      peer-opt: ^1.0.0',
      '    peerDependenciesMeta:',
      '      peer-opt:',
      '        optional: true',
      '  peer-x@2.0.0:',
      '    resolution: {integrity: sha512-x}',
      'snapshots:',
      '  lib-a@1.0.0(peer-x@2.0.0):',
      '    dependencies:',
      '      peer-x: 2.0.0',
      '  peer-x@2.0.0: {}',
      '',
    ].join('\n')
  }

  it('fails on a non-optional peer that no package of the deploy closure installs', async () => {
    const result = await verifyDeployClosurePeers(fixture({ 'pnpm-lock.yaml': lockfile(LIB_A) }))

    expect(result.failures).toEqual(['pnpm-lock.yaml: lib-a@1.0.0 -> peer-x (a non-optional peer no package of the deploy closure installs)'])
    expect(result.packageCount).toBe(1)
  })

  it('accepts the peer once a package of the closure depends on it', async () => {
    const result = await verifyDeployClosurePeers(fixture({ 'pnpm-lock.yaml': lockfile(LIB_A + PEER_X) }))

    expect(result.failures).toEqual([])
    expect(result.packageCount).toBe(2)
  })
})
