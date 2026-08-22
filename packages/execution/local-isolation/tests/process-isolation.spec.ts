import { describe, it, expect } from 'vitest'
import { probeIsolation, validateIsolation } from '../src/index.ts'

describe('P3-05 Process Isolation', () => {
  describe('probeIsolation', () => {
    it('probes Linux capabilities', () => {
      const att = probeIsolation('linux')
      expect(att.platform).toBe('linux')
      expect(att.capabilities).toContain('user-namespace')
      expect(att.capabilities).toContain('seccomp')
    })

    it('probes macOS capabilities', () => {
      const att = probeIsolation('macos')
      expect(att.platform).toBe('macos')
      expect(att.capabilities).toContain('seatbelt')
      expect(att.unsupported).toContain('pid-namespace')
    })

    it('probes Windows capabilities', () => {
      const att = probeIsolation('windows')
      expect(att.platform).toBe('windows')
      expect(att.capabilities).toContain('restricted-token')
      expect(att.unsupported).toContain('seccomp')
    })

    it('reports unsupported features', () => {
      const att = probeIsolation('macos')
      expect(att.unsupported.length).toBeGreaterThan(0)
    })

    it('Linux has strict isolation level', () => {
      const att = probeIsolation('linux')
      expect(att.level).toBe('strict')
    })
  })

  describe('validateIsolation', () => {
    it('validates complete Linux config', () => {
      const result = validateIsolation({
        platform: 'linux',
        userNamespace: true, pidNamespace: true, networkNamespace: true,
        mountNamespace: true, seccompFilter: true, restrictDevices: true,
        restrictIPC: true, restrictClipboard: true, restrictCamera: true,
        restrictGPU: true, restrictDockerSocket: true, restrictSSHAgent: true,
      })
      expect(result.success).toBe(true)
    })

    it('rejects Linux without seccomp', () => {
      const result = validateIsolation({
        platform: 'linux',
        userNamespace: true, pidNamespace: true, networkNamespace: true,
        mountNamespace: true, seccompFilter: false, restrictDevices: true,
        restrictIPC: true, restrictClipboard: true, restrictCamera: true,
        restrictGPU: true, restrictDockerSocket: true, restrictSSHAgent: true,
      })
      expect(result.success).toBe(false)
      expect(result.errors.some(e => e.includes('seccomp'))).toBe(true)
    })

    it('rejects Linux without Docker socket restriction', () => {
      const result = validateIsolation({
        platform: 'linux',
        userNamespace: true, pidNamespace: true, networkNamespace: true,
        mountNamespace: true, seccompFilter: true, restrictDevices: true,
        restrictIPC: true, restrictClipboard: true, restrictCamera: true,
        restrictGPU: true, restrictDockerSocket: false, restrictSSHAgent: true,
      })
      expect(result.success).toBe(false)
      expect(result.errors.some(e => e.includes('Docker'))).toBe(true)
    })

    it('validates macOS config', () => {
      const result = validateIsolation({
        platform: 'macos',
        userNamespace: false, pidNamespace: false, networkNamespace: false,
        mountNamespace: false, seccompFilter: false, restrictDevices: true,
        restrictIPC: true, restrictClipboard: true, restrictCamera: true,
        restrictGPU: true, restrictDockerSocket: true, restrictSSHAgent: true,
      })
      expect(result.success).toBe(true)
    })

    it('rejects macOS without clipboard restriction', () => {
      const result = validateIsolation({
        platform: 'macos',
        userNamespace: false, pidNamespace: false, networkNamespace: false,
        mountNamespace: false, seccompFilter: false, restrictDevices: true,
        restrictIPC: true, restrictClipboard: false, restrictCamera: true,
        restrictGPU: true, restrictDockerSocket: true, restrictSSHAgent: true,
      })
      expect(result.success).toBe(false)
    })

    it('attestation includes kernel version', () => {
      const result = validateIsolation({
        platform: 'linux',
        userNamespace: true, pidNamespace: true, networkNamespace: true,
        mountNamespace: true, seccompFilter: true, restrictDevices: true,
        restrictIPC: true, restrictClipboard: true, restrictCamera: true,
        restrictGPU: true, restrictDockerSocket: true, restrictSSHAgent: true,
      })
      expect(result.attestation.kernelVersion).toBeDefined()
    })

    it('unsupported features are reported', () => {
      const result = validateIsolation({
        platform: 'macos',
        userNamespace: false, pidNamespace: false, networkNamespace: false,
        mountNamespace: false, seccompFilter: false, restrictDevices: true,
        restrictIPC: true, restrictClipboard: true, restrictCamera: true,
        restrictGPU: true, restrictDockerSocket: true, restrictSSHAgent: true,
      })
      expect(result.attestation.unsupported).toContain('pid-namespace')
    })
  })
})
