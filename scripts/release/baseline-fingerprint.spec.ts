import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const baselinePath = join(repoRoot, '.dsh/baseline.json')

interface BaselineData {
  git_sha: string
  upstream_master_sha: string | null
  node_version: string
  pnpm_version: string
  platform: string
  schema_hashes: Record<string, string>
  manifest_hashes: Record<string, string>
  bundle_row_ids: string[]
  workspace_packages: { name: string; version: string }[]
}

function loadBaseline(): BaselineData {
  const raw: unknown = JSON.parse(readFileSync(baselinePath, 'utf8'))
  return raw as BaselineData
}

describe('P0-01 baseline fingerprint', () => {
  it('baseline.json exists and is valid JSON', () => {
    expect(existsSync(baselinePath)).toBe(true)
    const data = loadBaseline()
    expect(data.git_sha).toBeTruthy()
    expect(data.upstream_master_sha).toBeTruthy()
    expect(data.node_version).toBeTruthy()
    expect(data.pnpm_version).toBeTruthy()
    expect(data.schema_hashes).toBeTypeOf('object')
    expect(data.manifest_hashes).toBeTypeOf('object')
    expect(Array.isArray(data.bundle_row_ids)).toBe(true)
    expect(data.bundle_row_ids.length).toBeGreaterThan(0)
    expect(Array.isArray(data.workspace_packages)).toBe(true)
    expect(data.workspace_packages.length).toBeGreaterThan(0)
  })

  it('fingerprint covers all declared schema files', () => {
    const data = loadBaseline()
    const expected = [
      'packages/sdk/protocol/src/types.ts',
      'packages/core/session/src/types.ts',
      'packages/core/session/src/known-event-types.ts',
      'packages/bundle/base/cordis.patch.yml',
      'packages/core/agent/src/types.ts',
      'packages/core/agent-loop/src/runtime-context.ts',
    ]
    for (const f of expected) {
      expect(data.schema_hashes[f], `schema hash for ${f}`).toBeTruthy()
    }
  })

  it('fingerprint covers all declared manifest files', () => {
    const data = loadBaseline()
    const expected = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
    for (const f of expected) {
      expect(data.manifest_hashes[f], `manifest hash for ${f}`).toBeTruthy()
    }
  })

  it('bundle row IDs match cordis.patch.yml', () => {
    const data = loadBaseline()
    const yaml = readFileSync(join(repoRoot, 'packages/bundle/base/cordis.patch.yml'), 'utf8')
    const expected = yaml.split('\n').flatMap((line) => {
      const m = line.match(/^\s+-\s+id:\s+(\S+)/)
      return m ? [m[1]] : []
    })
    expect(data.bundle_row_ids).toEqual(expected)
  })

  it('fingerprint is deterministic (no timestamps)', () => {
    const data = loadBaseline()
    const json = JSON.stringify(data)
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(json).not.toMatch(/timestamp/i)
  })

  it('baseline:verify passes on clean checkout', () => {
    const result = execSync('node scripts/release/baseline-fingerprint.mjs verify', {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    expect(result).toContain('PASS')
  })

  it('baseline:verify detects schema drift', () => {
    const schemaPath = join(repoRoot, 'packages/sdk/protocol/src/types.ts')
    const original = readFileSync(schemaPath, 'utf8')
    const tampered = original + '\n// DRIFT_CANARY\n'
    try {
      writeFileSync(schemaPath, tampered)
      let threw = false
      try {
        execSync('node scripts/release/baseline-fingerprint.mjs verify', {
          cwd: repoRoot,
          encoding: 'utf8',
        })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    } finally {
      writeFileSync(schemaPath, original)
    }
  })

  it('baseline:verify detects manifest drift', () => {
    const manifestPath = join(repoRoot, 'package.json')
    const original = readFileSync(manifestPath, 'utf8')
    const data: Record<string, unknown> = JSON.parse(original) as Record<string, unknown>
    try {
      const tampered = JSON.stringify({ ...data, _drift_canary: true }, null, 2)
      writeFileSync(manifestPath, tampered + '\n')
      let threw = false
      try {
        execSync('node scripts/release/baseline-fingerprint.mjs verify', {
          cwd: repoRoot,
          encoding: 'utf8',
        })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    } finally {
      writeFileSync(manifestPath, original)
    }
  })

  it('baseline:verify detects bundle row ID drift', () => {
    const yamlPath = join(repoRoot, 'packages/bundle/base/cordis.patch.yml')
    const original = readFileSync(yamlPath, 'utf8')
    try {
      const tampered = original.replace(
        /^(\s+-\s+id:\s+)(\S+)/m,
        '$1drift-canary-id',
      )
      writeFileSync(yamlPath, tampered)
      let threw = false
      try {
        execSync('node scripts/release/baseline-fingerprint.mjs verify', {
          cwd: repoRoot,
          encoding: 'utf8',
        })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    } finally {
      writeFileSync(yamlPath, original)
    }
  })

  it('baseline:verify recovers after restoring files', () => {
    const result = execSync('node scripts/release/baseline-fingerprint.mjs verify', {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    expect(result).toContain('PASS')
  })

  it('baseline records upstream master SHA', () => {
    const data = loadBaseline()
    const upstreamSha = execSync('git rev-parse origin/master', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim()
    expect(data.upstream_master_sha).toBe(upstreamSha)
    expect(data.git_sha).toBeTruthy()
  })
})
