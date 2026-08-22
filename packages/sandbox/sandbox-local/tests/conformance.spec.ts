import { describe, it, expect } from 'vitest'
import { probeCapabilities, validateConfig, isFailClosed } from '../src/capabilities.ts'
import type { IsolationConfig } from '../src/attestation.ts'

describe('P3-07 Sandbox Fail-Closed Hardening', () => {
  it('probes Linux with strict level', () => {
    const att = probeCapabilities('linux')
    expect(att.level).toBe('strict')
    expect(att.capabilities).toContain('seccomp')
  })

  it('probes macOS with basic level', () => {
    const att = probeCapabilities('macos')
    expect(att.level).toBe('basic')
    expect(att.capabilities).toContain('seatbelt')
  })

  it('validates complete Linux config', () => {
    const config: IsolationConfig = {
      platform: 'linux', seccompFilter: true, restrictDevices: true,
      restrictIPC: true, restrictClipboard: true, restrictCamera: true,
      restrictDockerSocket: true, restrictSSHAgent: true,
    }
    const result = validateConfig(config)
    expect(result.success).toBe(true)
  })

  it('rejects Linux without seccomp', () => {
    const config: IsolationConfig = {
      platform: 'linux', seccompFilter: false, restrictDevices: true,
      restrictIPC: true, restrictClipboard: true, restrictCamera: true,
      restrictDockerSocket: true, restrictSSHAgent: true,
    }
    const result = validateConfig(config)
    expect(result.success).toBe(false)
    expect(result.errors.some(e => e.includes('seccomp'))).toBe(true)
  })

  it('rejects macOS without clipboard restriction', () => {
    const config: IsolationConfig = {
      platform: 'macos', seccompFilter: false, restrictDevices: true,
      restrictIPC: true, restrictClipboard: false, restrictCamera: true,
      restrictDockerSocket: true, restrictSSHAgent: true,
    }
    const result = validateConfig(config)
    expect(result.success).toBe(false)
  })

  it('fail-closed when level is not none', () => {
    const att = probeCapabilities('linux')
    expect(isFailClosed(att)).toBe(true)
  })

  it('attestation includes kernel version', () => {
    const att = probeCapabilities('linux')
    expect(att.kernelVersion).toBeDefined()
  })

  it('reports unsupported features', () => {
    const att = probeCapabilities('macos')
    expect(att.unsupported).toContain('seccomp')
  })
})
