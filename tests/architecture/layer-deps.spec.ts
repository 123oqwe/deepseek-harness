 import { describe, it, expect } from 'vitest'
 import { check } from '../../scripts/architecture/check-layer-deps.mjs'

 describe('P0-04 Layer dependency rules', () => {
   it('layering doc exists', async () => {
     const { existsSync } = await import('node:fs')
     const { join } = await import('node:path')
     const { fileURLToPath } = await import('node:url')
     const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..')
     expect(existsSync(join(repoRoot, 'docs/architecture/layering.md'))).toBe(true)
   })

   it('check returns violations array', () => {
     const result = check()
     expect(Array.isArray(result.violations)).toBe(true)
   })

   it('checker detects upward dependencies and reports them', () => {
     const result = check()
     // The existing codebase has known upward deps; the checker must report them
     expect(result.violations.length).toBeGreaterThan(0)
     // Each violation has the required fields
     for (const v of result.violations.slice(0, 5)) {
       expect(v.message).toBeTruthy()
       expect(v.file).toBeTruthy()
       expect(v.import).toBeTruthy()
     }
  })
 })
