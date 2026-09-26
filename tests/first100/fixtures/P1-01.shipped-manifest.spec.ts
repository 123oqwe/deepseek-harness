/**
 * P1-01 (「Plugin Manifest v2：声明能力、权限与副作用」) on what ships, BLOCKED-273:
 * whether any bundle layer of the shipped profile templates declares a
 * Manifest v2 that the product's own reader reads, and whether a production
 * admission lets the shipped headless template keep any of its own layers.
 *
 * The reader is the one a real boot uses: `readPluginDeclaration` classifies a
 * bundle package's `package.json` `dsh` field, and
 * `partitionProfileLayersByAdmission` passes each layer's declaration to
 * `evaluatePreMountAdmission`. The control runs the same reader over a package
 * whose `dsh` field is the plugin-manifest package's own well-formed v2
 * fixture, so a red case below measures what ships and not the probe. Nothing
 * boots; the cases read package manifests only.
 * @module tests/first100/fixtures/P1-01.shipped-manifest
 */

import { existsSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROFILE_TEMPLATES, readPluginDeclaration } from '@deepseek-ai/dsh-app-boot'
import { evaluatePreMountAdmission, type PluginDeclaration } from '@deepseek-ai/dsh-plugin-manifest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const bundleRoot = fileURLToPath(new URL('../../../packages/bundle/', import.meta.url))
const benignFixture = fileURLToPath(new URL('../../../packages/plugin/plugin-manifest/tests/fixtures/benign.json', import.meta.url))

/** One bundle layer of one shipped template, as the product's reader classified it. */
interface ShippedLayer {
  readonly template: string
  readonly bundle: string
  readonly declaration: PluginDeclaration
}

/**
 * Whether a declaration is a Manifest v2 that declares at least one capability
 * carrying a side-effect class: a tool, a skill or an MCP server.
 * @param declaration - one classified declaration.
 * @returns true for such a manifest.
 */
function declaresEffectfulCapability(declaration: PluginDeclaration): boolean {
  if (declaration.kind !== 'manifest-v2') return false
  const { manifest } = declaration
  return (manifest.tools?.length ?? 0) + (manifest.skills?.length ?? 0) + (manifest.mcp?.servers.length ?? 0) > 0
}

/**
 * A layer list reduced to what a failure message needs.
 * @param layers - classified layers.
 * @returns each layer's template, bundle and declaration kind.
 */
function census(layers: readonly ShippedLayer[]): string {
  return JSON.stringify(layers.map(layer => ({ template: layer.template, bundle: layer.bundle, kind: layer.declaration.kind })))
}

let layers: readonly ShippedLayer[] = []
let controlDir: string | undefined

beforeAll(async () => {
  const bundleDirs = new Map<string, string>()
  for (const entry of await readdir(bundleRoot, { withFileTypes: true })) {
    const manifestPath = join(bundleRoot, entry.name, 'package.json')
    if (!entry.isDirectory() || !existsSync(manifestPath)) continue
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { name?: unknown }
    if (typeof manifest.name === 'string') bundleDirs.set(manifest.name, join(bundleRoot, entry.name))
  }
  layers = Object.entries(PROFILE_TEMPLATES).flatMap(([template, { bundles }]) => bundles.map((bundle) => {
    const dir = bundleDirs.get(bundle)
    if (dir === undefined) throw new Error(`shipped template ${template} names bundle ${bundle}, which no packages/bundle/*/package.json declares`)
    return { template, bundle, declaration: readPluginDeclaration(dir) }
  }))
  controlDir = await mkdtemp(join(tmpdir(), 'p1-01-shipped-manifest-control-'))
  const benign = JSON.parse(await readFile(benignFixture, 'utf8')) as unknown
  await writeFile(join(controlDir, 'package.json'), JSON.stringify({ name: 'p1-01-control-plugin', version: '0.0.0', dsh: benign }))
})

afterAll(async () => {
  if (controlDir !== undefined) await rm(controlDir, { recursive: true, force: true })
})

describe('P1-01 on the shipped profile templates: Manifest v2 declared and read', () => {
  it('control: the product\'s reader classifies a package declaring the benign v2 fixture as manifest-v2 and a production admission lets it in', () => {
    if (controlDir === undefined) throw new Error('the control package was not written')
    const declaration = readPluginDeclaration(controlDir)
    expect(declaration.kind).toBe('manifest-v2')
    expect(declaresEffectfulCapability(declaration)).toBe(true)
    expect(evaluatePreMountAdmission(declaration, true).admitted).toBe(true)
  })

  it('P1-01 must[0] and must[1]: at least one bundle layer of the shipped templates declares a Manifest v2 with an effectful capability that the reader reads', () => {
    expect(layers.length, census(layers)).toBeGreaterThan(0)
    expect(layers.filter(layer => declaresEffectfulCapability(layer.declaration)).map(layer => layer.bundle), census(layers))
      .not.toEqual([])
  })

  it('P1-01 must[3]: under a production admission the shipped headless template keeps at least one of its own layers', () => {
    const headless = layers.filter(layer => layer.template === 'headless')
    expect(headless.length, census(headless)).toBeGreaterThan(0)
    const kept = headless.filter(layer => evaluatePreMountAdmission(layer.declaration, true).admitted)
    expect(kept.map(layer => layer.bundle), census(headless)).not.toEqual([])
  })
})
