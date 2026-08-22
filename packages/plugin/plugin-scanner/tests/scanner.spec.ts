import { describe, it, expect } from 'vitest'
import { staticScan, dynamicScan, RULES } from '../src/index.ts'

describe('P1-05 Plugin Scanner', () => {
  describe('staticScan', () => {
    it('detects child_process import', () => {
      const result = staticScan({
        files: [{ path: 'index.ts', content: 'const cp = require(\'child_process\')' }],
      })
      expect(result.findings.some(f => f.rule === 'R001')).toBe(true)
      expect(result.passed).toBe(false)
    })

    it('detects eval usage', () => {
      const result = staticScan({
        files: [{ path: 'index.ts', content: 'eval(\'console.log(1)\')' }],
      })
      expect(result.findings.some(f => f.rule === 'R004')).toBe(true)
      expect(result.passed).toBe(false)
    })

    it('detects native addon', () => {
      const result = staticScan({
        files: [{ path: 'binding.gyp', content: 'node_addon_api' }],
      })
      expect(result.findings.some(f => f.rule === 'R005')).toBe(true)
    })

    it('detects dynamic require', () => {
      const result = staticScan({
        files: [{ path: 'index.ts', content: 'const mod = require(moduleName)' }],
      })
      expect(result.findings.some(f => f.rule === 'R006')).toBe(true)
    })

    it('detects postinstall script', () => {
      const result = staticScan({
        files: [],
        packageJson: { scripts: { postinstall: 'node build.js' } },
      })
      expect(result.findings.some(f => f.rule === 'R009')).toBe(true)
      expect(result.passed).toBe(false)
    })

    it('passes on benign code', () => {
      const result = staticScan({
        files: [{ path: 'index.ts', content: 'export function add(a: number, b: number) { return a + b }' }],
      })
      expect(result.passed).toBe(true)
      expect(result.findings.filter(f => f.severity === 'blocking')).toHaveLength(0)
    })

    it('detects fs write operations', () => {
      const result = staticScan({
        files: [{ path: 'index.ts', content: 'fs.writeFile(\'/etc/passwd\', \'hacked\')' }],
      })
      expect(result.findings.some(f => f.rule === 'R002')).toBe(true)
    })

    it('detects net server creation', () => {
      const result = staticScan({
        files: [{ path: 'index.ts', content: 'net.createServer(handler)' }],
      })
      expect(result.findings.some(f => f.rule === 'R003')).toBe(true)
    })

    it('flags large dependency count as informational', () => {
      const result = staticScan({ files: [], dependencyCount: 60 })
      const depFinding = result.findings.find(f => f.rule === 'R014')
      expect(depFinding?.severity).toBe('informational')
    })
  })

  describe('dynamicScan', () => {
    it('detects undeclared network access', () => {
      const result = dynamicScan({
        manifestDeclarations: { network: ['https://api.example.com'] },
        observedBehavior: { networkCalls: ['https://evil.com'], fsWrites: [], processSpawns: [] },
      })
      expect(result.findings.some(f => f.rule === 'R010')).toBe(true)
      expect(result.passed).toBe(false)
    })

    it('passes when network is declared', () => {
      const result = dynamicScan({
        manifestDeclarations: { network: ['https://api.example.com'] },
        observedBehavior: { networkCalls: ['https://api.example.com'], fsWrites: [], processSpawns: [] },
      })
      expect(result.passed).toBe(true)
    })

    it('detects undeclared filesystem write', () => {
      const result = dynamicScan({
        manifestDeclarations: { filesystem: ['/tmp/app'] },
        observedBehavior: { networkCalls: [], fsWrites: ['/etc/passwd'], processSpawns: [] },
      })
      expect(result.findings.some(f => f.rule === 'R011')).toBe(true)
      expect(result.passed).toBe(false)
    })

    it('detects undeclared process spawn', () => {
      const result = dynamicScan({
        manifestDeclarations: { process: false },
        observedBehavior: { networkCalls: [], fsWrites: [], processSpawns: ['bash'] },
      })
      expect(result.findings.some(f => f.rule === 'R012')).toBe(true)
    })

    it('fails on timeout', () => {
      const result = dynamicScan({
        manifestDeclarations: {},
        observedBehavior: { networkCalls: [], fsWrites: [], processSpawns: [] },
        timedOut: true,
      })
      expect(result.passed).toBe(false)
      expect(result.timedOut).toBe(true)
    })

    it('fails on crash', () => {
      const result = dynamicScan({
        manifestDeclarations: {},
        observedBehavior: { networkCalls: [], fsWrites: [], processSpawns: [] },
        crashed: true,
      })
      expect(result.passed).toBe(false)
      expect(result.crashed).toBe(true)
    })

    it('wildcard declaration allows any', () => {
      const result = dynamicScan({
        manifestDeclarations: { network: ['*'] },
        observedBehavior: { networkCalls: ['https://anything.com'], fsWrites: [], processSpawns: [] },
      })
      expect(result.passed).toBe(true)
    })
  })

  describe('rules', () => {
    it('has 14 rules', () => {
      expect(RULES).toHaveLength(14)
    })

    it('all rules have version', () => {
      for (const rule of RULES) {
        expect(rule.version).toBeDefined()
      }
    })
  })
})
