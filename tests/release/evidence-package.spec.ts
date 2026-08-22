 import { describe, it, expect, beforeEach, afterEach } from 'vitest'
 import { createHash } from 'node:crypto'
 import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
 import { join, dirname } from 'node:path'
 import { fileURLToPath } from 'node:url'
 import { execSync } from 'node:child_process'

 const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
 const evidenceDir = join(repoRoot, 'artifacts/evidence/release')
 const evidencePath = join(evidenceDir, 'evidence-package.json')

 function sha256(data: string): string {
   return createHash('sha256').update(data).digest('hex')
 }

 describe('P0-07 Release Evidence Package', () => {
   beforeEach(() => {
     mkdirSync(evidenceDir, { recursive: true })
   })

   afterEach(() => {
     if (existsSync(evidencePath)) rmSync(evidencePath)
   })

   it('collects evidence for a passing command', () => {
     execSync('node scripts/release/collect-evidence.mjs --gate test -- node -e "console.log(\'pass\')"', {
       cwd: repoRoot,
       encoding: 'utf8',
     })
     expect(existsSync(evidencePath)).toBe(true)
     const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
     expect(evidence.gitSha).toBeTruthy()
     expect(evidence.collectedAt).toBeTruthy()
     expect(evidence.gates).toHaveLength(1)
     expect(evidence.gates[0].exitCode).toBe(0)
     expect(evidence.gates[0].accepted).toBe(true)
     expect(evidence.accepted).toBe(true)
     expect(evidence.packageDigest).toBeTruthy()
   })

   it('collects evidence for a failing command', () => {
     let threw = false
     try {
       execSync('node scripts/release/collect-evidence.mjs --gate fail -- node -e "process.exit(1)"', {
         cwd: repoRoot,
         encoding: 'utf8',
       })
     } catch {
       threw = true
     }
     // The command itself might throw, but evidence should still be collected
     expect(existsSync(evidencePath)).toBe(true)
     const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
     expect(evidence.gates[0].exitCode).toBe(1)
     expect(evidence.gates[0].accepted).toBe(false)
     expect(evidence.accepted).toBe(false)
   })

   it('verifies a valid evidence package', () => {
     execSync('node scripts/release/collect-evidence.mjs --gate test -- node -e "console.log(\'pass\')"', {
       cwd: repoRoot,
       encoding: 'utf8',
     })
     const result = execSync('node scripts/release/verify-evidence.mjs', {
       cwd: repoRoot,
       encoding: 'utf8',
     })
     expect(result).toContain('VERIFIED')
   })

   it('detects tampered package digest', () => {
     execSync('node scripts/release/collect-evidence.mjs --gate test -- node -e "console.log(\'pass\')"', {
       cwd: repoRoot,
       encoding: 'utf8',
     })
     const original = readFileSync(evidencePath, 'utf8')
     const evidence = JSON.parse(original)
     evidence.gitSha = 'tampered'
     writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n')
     let threw = false
     try {
       execSync('node scripts/release/verify-evidence.mjs', { cwd: repoRoot, encoding: 'utf8' })
     } catch {
       threw = true
     }
     expect(threw).toBe(true)
   })

   it('detects missing evidence package', () => {
     if (existsSync(evidencePath)) rmSync(evidencePath)
     let threw = false
     try {
       execSync('node scripts/release/verify-evidence.mjs', { cwd: repoRoot, encoding: 'utf8' })
     } catch {
       threw = true
     }
     expect(threw).toBe(true)
   })

   it('evidence package has required fields', () => {
     execSync('node scripts/release/collect-evidence.mjs --gate test -- node -e "console.log(\'pass\')"', {
       cwd: repoRoot,
       encoding: 'utf8',
     })
     const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
     expect(evidence.collectedAt).toBeTruthy()
     expect(evidence.gitSha).toBeTruthy()
     expect(evidence.gitDiffSummary).toBeDefined()
     expect(Array.isArray(evidence.gates)).toBe(true)
     expect(evidence.buildArtifactDigests).toBeTypeOf('object')
     expect(typeof evidence.accepted).toBe('boolean')
     expect(evidence.packageDigest).toMatch(/^[0-9a-f]{64}$/)
   })

   it('gate result has stdout and stderr digests', () => {
     execSync('node scripts/release/collect-evidence.mjs --gate test -- node -e "console.log(\'pass\')"', {
       cwd: repoRoot,
       encoding: 'utf8',
     })
     const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
     const gate = evidence.gates[0]
     expect(gate.stdoutDigest).toMatch(/^[0-9a-f]{64}$/)
     expect(gate.stderrDigest).toMatch(/^[0-9a-f]{64}$/)
     expect(gate.command).toContain('node')
     expect(gate.startedAt).toBeTruthy()
     expect(gate.finishedAt).toBeTruthy()
   })
 })
