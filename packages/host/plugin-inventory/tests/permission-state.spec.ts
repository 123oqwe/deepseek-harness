/**
 * Provider-stage proof for Epic P1-01's plugin-inventory composition
 * (acceptance[1]: "Plugin Inventory 能展示声明权限、实际观察权限、版本与来源"):
 * `PluginPermissionState` and its `PluginPackageIdentity`/`PluginProvenance`
 * fields genuinely compose with `@deepseek-ai/dsh-plugin-manifest`'s real
 * Provider-stage runtime — `classifyPluginDeclaration`,
 * `compareDeclaredToObserved`, and `decidePluginTrust` — end to end.
 */

import { describe, expect, it } from 'vitest'
import {
  classifyPluginDeclaration,
  compareDeclaredToObserved,
  decidePluginTrust,
  type ObservedPluginCapabilities,
  type PluginManifestV2,
} from '@deepseek-ai/dsh-plugin-manifest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { PluginEntryId, PluginManifestDigest, PluginPermissionState } from '../src/types.ts'

/**
 * Epic P1-02's two recorded provenance fields, fixed for these P1-01 cases:
 * they assert declared-vs-observed permission composition, which no
 * provenance value participates in. `packages/host/plugin-inventory/tests/provenance-record.spec.ts`
 * owns the real recomputation and recording.
 */
const UNRECORDED_PROVENANCE = {
  manifestDigest: brandString<PluginManifestDigest>(`sha256:${'0'.repeat(64)}`),
  provenanceAudit: {
    trust: 'unverified',
    reason: 'no-provenance-claim',
    verifiedAt: '2026-09-04T00:00:00.000Z',
  },
} as const

const BENIGN_MANIFEST: PluginManifestV2 = {
  manifestVersion: 2,
  services: [{ ctxKey: 'exampleService', role: 'provides' }],
  tools: [
    {
      name: 'example-format-note',
      sideEffectClass: 'none',
      authAudience: ['model'],
      allowedDestinations: [],
      dataClassification: 'internal',
    },
  ],
  executionMode: 'in-process',
  compatibility: { dshVersionRange: '>=0.1.0 <1.0.0' },
}

function entryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

describe('PluginPermissionState composition with @deepseek-ai/dsh-plugin-manifest', () => {
  it('builds an active permission state when observed registrations exactly match the declared manifest', () => {
    const declaration = classifyPluginDeclaration(BENIGN_MANIFEST)
    expect(declaration.kind).toBe('manifest-v2')
    if (declaration.kind !== 'manifest-v2') return

    const observed: ObservedPluginCapabilities = {
      ctxKeys: ['exampleService'],
      toolNames: ['example-format-note'],
      skillNames: [],
      mcpServerNames: [],
      eventNames: [],
    }
    const comparison = compareDeclaredToObserved(declaration.manifest, observed)
    const trustDecision = decidePluginTrust(comparison)

    const state: PluginPermissionState = {
      entryId: entryId('cordis:example-plugin'),
      packageIdentity: { name: '@example/dsh-plugin-example', version: '1.2.3' },
      provenance: { kind: 'bundle', source: '@example/dsh-plugin-example' },
      declaration,
      observed,
      comparison,
      trustDecision,
      ...UNRECORDED_PROVENANCE,
    }

    expect(state.trustDecision).toBe('active')
    expect(state.comparison?.mismatches).toEqual([])
  })

  it('builds a quarantined permission state when the plugin registered a tool its manifest never declared', () => {
    const declaration = classifyPluginDeclaration(BENIGN_MANIFEST)
    expect(declaration.kind).toBe('manifest-v2')
    if (declaration.kind !== 'manifest-v2') return

    const observed: ObservedPluginCapabilities = {
      ctxKeys: ['exampleService'],
      toolNames: ['example-format-note', 'undeclared-tool'],
      skillNames: [],
      mcpServerNames: [],
      eventNames: [],
    }
    const comparison = compareDeclaredToObserved(declaration.manifest, observed)
    const trustDecision = decidePluginTrust(comparison)

    const state: PluginPermissionState = {
      entryId: entryId('cordis:example-plugin'),
      packageIdentity: { name: '@example/dsh-plugin-example', version: '1.2.3' },
      provenance: { kind: 'agent-preset', source: 'standard' },
      declaration,
      observed,
      comparison,
      trustDecision,
      ...UNRECORDED_PROVENANCE,
    }

    expect(state.trustDecision).toBe('quarantined')
    expect(state.comparison?.mismatches).toEqual([
      { kind: 'undeclared-registration', category: 'tool', name: 'undeclared-tool' },
    ])
  })

  it('carries a missing declaration and no comparison for a plugin with no manifest at all', () => {
    const declaration = classifyPluginDeclaration(undefined)
    expect(declaration).toEqual({ kind: 'missing' })

    const state: PluginPermissionState = {
      entryId: entryId('cordis:undeclared-plugin'),
      packageIdentity: { name: '@example/dsh-plugin-undeclared', version: '0.0.1' },
      provenance: { kind: 'built-in' },
      declaration,
      observed: { ctxKeys: [], toolNames: [], skillNames: [], mcpServerNames: [], eventNames: [] },
      ...UNRECORDED_PROVENANCE,
    }

    expect(state.declaration.kind).toBe('missing')
    expect(state.comparison).toBeUndefined()
    expect(state.trustDecision).toBeUndefined()
    expect(state.provenance.source).toBeUndefined()
  })
})
