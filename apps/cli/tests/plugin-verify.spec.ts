/**
 * `pnpm plugin:verify <fixture>` (Epic P1-01.U's `apps/cli/src/plugin.ts`
 * `runPluginVerify`, dispatched via `args.ts`'s `plugin-verify` command):
 * real fixture-file verification against `@deepseek-ai/dsh-plugin-manifest`'s
 * `classifyPluginDeclaration`/`evaluatePreMountAdmission`, proving the
 * registry's own `verifyCommand` actually runs and reports the production
 * admission decision the registry's `validation` list names.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPluginVerify } from '../src/plugin.ts'

const FIXTURES_DIR = fileURLToPath(new URL('../../../packages/plugin/plugin-manifest/tests/fixtures/', import.meta.url))

function capture(): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = []
  const stderr: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { stdout.push(String(chunk)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => { stderr.push(String(chunk)); return true })
  return { stdout, stderr }
}

afterEach(() => { vi.restoreAllMocks() })

describe('runPluginVerify', () => {
  it('admits the benign fixture (exit 0)', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'benign.json'))).toBe(0)
    expect(output.stdout.join('')).toContain('ADMITTED')
  })

  it('denies the overprivileged fixture with the real wildcard findings (acceptance[0])', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'overprivileged.json'))).toBe(1)
    const printed = output.stdout.join('')
    expect(printed).toContain('DENIED (wildcard-permission)')
    expect(printed).toContain('tools[0].allowedDestinations')
  })

  it('denies the undeclared-tool fixture as missing (a manifest-v2 field failing schema validation classifies as missing)', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'undeclared-tool.json'))).toBe(1)
    expect(output.stdout.join('')).toContain('DENIED (missing-manifest)')
  })

  it('denies the undeclared-network fixture (acceptance[3]: a remote provider with no declared destination fails schema)', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'undeclared-network.json'))).toBe(1)
    expect(output.stdout.join('')).toContain('DENIED (missing-manifest)')
  })

  it('denies the legacy-bundle fixture as legacy-untrusted (must[3])', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'legacy-bundle.json'))).toBe(1)
    expect(output.stdout.join('')).toContain('DENIED (legacy-untrusted)')
  })

  it('denies a fixture with no dsh field at all as missing-manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-plugin-verify-'))
    const fixture = join(dir, 'empty.json')
    writeFileSync(fixture, '{}')
    const output = capture()
    expect(runPluginVerify(fixture)).toBe(1)
    expect(output.stdout.join('')).toContain('DENIED (missing-manifest)')
  })

  it('reports 1 and writes to stderr for an unreadable fixture path', () => {
    const output = capture()
    expect(runPluginVerify('/no/such/fixture.json')).toBe(1)
    expect(output.stderr.join('')).toContain('cannot read fixture')
  })

  // Registry validation item: "新增恶意 MCP server 与 Skill 脚本夹具，验证 schema
  // 欺骗、tool-name collision、elicitation 和 secret 请求被拦截" — three malicious
  // fixtures proving schema spoofing, a structurally incomplete MCP server
  // declaration, and an unjustified secret request are all denied through the
  // real CLI path. `malicious-mcp-elicitation.json` does NOT prove elicitation
  // detection: its first server — the one carrying the suspiciously-named
  // `elicit-confidential-data` prompt — is fully schema-compliant on its own
  // and would be ADMITTED if submitted alone (proved below by
  // `mcp-suspicious-prompt-name-admitted.json`, the same server in isolation).
  // The combined fixture is denied only because its second, unrelated server
  // is missing `transport`/`authMechanism`, an ordinary acceptance[3]
  // structural-completeness check. Nothing in this system does semantic or
  // content-based detection of a malicious prompt name.
  // Tool-name collision is separately proved live at
  // `apps/cli/tests/plugin-enforcement.spec.ts` (citing the existing
  // `dsh-core-tools` coverage this epic did not need to duplicate).
  it('denies a schema-spoofed manifest (an invalid sideEffectClass value) as missing-manifest', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'malicious-schema-spoof.json'))).toBe(1)
    expect(output.stdout.join('')).toContain('DENIED (missing-manifest)')
  })

  it('denies a manifest whose second, unrelated MCP server is missing transport/auth (acceptance[3] structural completeness — not elicitation detection)', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'malicious-mcp-elicitation.json'))).toBe(1)
    expect(output.stdout.join('')).toContain('DENIED (missing-manifest)')
  })

  it('admits a well-formed MCP server whose only red flag is a suspicious prompt name (no semantic elicitation detection, by disclosed design)', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'mcp-suspicious-prompt-name-admitted.json'))).toBe(0)
    expect(output.stdout.join('')).toContain('ADMITTED')
  })

  it('denies a skill manifest requesting a secret with no declared justification', () => {
    const output = capture()
    expect(runPluginVerify(join(FIXTURES_DIR, 'malicious-skill-secret-request.json'))).toBe(1)
    expect(output.stdout.join('')).toContain('DENIED (missing-manifest)')
  })
})
