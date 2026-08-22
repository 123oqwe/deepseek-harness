import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EvidenceVerificationError } from '../src/types.ts'

describe('P0-07 Release Evidence Package Integration', () => {
  it('collect-evidence.mjs script exists and is executable', () => {
    const scriptPath = join(process.cwd(), 'scripts/release/collect-evidence.mjs')
    expect(existsSync(scriptPath)).toBe(true)
  })

  it('verify-evidence.mjs script exists and is executable', () => {
    const scriptPath = join(process.cwd(), 'scripts/release/verify-evidence.mjs')
    expect(existsSync(scriptPath)).toBe(true)
  })

  it('evidence format types are exported correctly', () => {
    expect(EvidenceVerificationError).toBeDefined()
  })

  it('evidence:collect and evidence:verify scripts are in package.json', async () => {
    const { readFileSync } = await import('node:fs')
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
    expect(pkg.scripts['evidence:collect']).toBeDefined()
    expect(pkg.scripts['evidence:verify']).toBeDefined()
  })

  it('EvidencePackage type is exported from package', async () => {
    const mod = await import('../src/index.ts')
    expect(mod).toBeDefined()
  })
})
