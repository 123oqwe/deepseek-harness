import { describe, it, expect } from 'vitest'
import { DEFAULT_DENY_POLICY, checkFsAccess, checkNetworkAccess, checkProcessAccess, checkSecretAccess, type SandboxPolicy } from '../src/index.ts'

const permissivePolicy: SandboxPolicy = {
  fs: { allowedReadPaths: ['/workspace'], allowedWritePaths: ['/workspace/out'], denySymlinks: true },
  net: { allowedDestinations: ['api.example.com'], allowedPorts: [443], denyAllNetwork: false },
  proc: { allowedCommands: ['node', 'npm'], allowShell: false, maxProcesses: 4 },
  ipc: { allowedNamespaces: ['dsh'], denyAll: false },
  device: { allowedDevices: [], denyAll: true },
  secret: { allowedSecrets: ['api-key'], denyAll: false },
  resource: { maxCpuPercent: 50, maxMemoryMB: 512, maxDiskMB: 1024, maxWallTimeSeconds: 300 },
}

describe('P3-02 Sandbox Policy', () => {
  it('default deny policy rejects everything', () => {
    expect(checkFsAccess(DEFAULT_DENY_POLICY, '/any', 'read')).toBe(false)
    expect(checkNetworkAccess(DEFAULT_DENY_POLICY, 'any', 443)).toBe(false)
    expect(checkProcessAccess(DEFAULT_DENY_POLICY, 'node')).toBe(false)
    expect(checkSecretAccess(DEFAULT_DENY_POLICY, 'any')).toBe(false)
  })

  it('checks fs read access', () => {
    expect(checkFsAccess(permissivePolicy, '/workspace/file', 'read')).toBe(true)
    expect(checkFsAccess(permissivePolicy, '/etc/passwd', 'read')).toBe(false)
  })

  it('checks fs write access', () => {
    expect(checkFsAccess(permissivePolicy, '/workspace/out/file', 'write')).toBe(true)
    expect(checkFsAccess(permissivePolicy, '/workspace/file', 'write')).toBe(false)
  })

  it('checks network access', () => {
    expect(checkNetworkAccess(permissivePolicy, 'api.example.com', 443)).toBe(true)
    expect(checkNetworkAccess(permissivePolicy, 'evil.com', 443)).toBe(false)
    expect(checkNetworkAccess(permissivePolicy, 'api.example.com', 8080)).toBe(false)
  })

  it('rejects shell commands when allowShell is false', () => {
    expect(checkProcessAccess(permissivePolicy, 'node')).toBe(true)
    expect(checkProcessAccess(permissivePolicy, 'node && rm -rf /')).toBe(false)
  })

  it('checks secret access', () => {
    expect(checkSecretAccess(permissivePolicy, 'api-key')).toBe(true)
    expect(checkSecretAccess(permissivePolicy, 'db-password')).toBe(false)
  })
})
