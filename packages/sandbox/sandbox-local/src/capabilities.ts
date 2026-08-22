import type { IsolationConfig, IsolationAttestation, IsolationResult, Platform } from './attestation.ts'

export function probeCapabilities(platform: Platform): IsolationAttestation {
  const capabilities: string[] = []
  const unsupported: string[] = []

  switch (platform) {
    case 'linux':
      capabilities.push('user-namespace', 'pid-namespace', 'seccomp', 'landlock', 'bubblewrap')
      break
    case 'macos':
      capabilities.push('seatbelt')
      unsupported.push('user-namespace', 'pid-namespace', 'seccomp')
      break
    case 'windows':
      capabilities.push('restricted-token', 'job-object', 'acl')
      unsupported.push('user-namespace', 'seccomp', 'landlock')
      break
  }

  return {
    platform,
    level: unsupported.length === 0 ? 'strict' : unsupported.length <= 3 ? 'basic' : 'none',
    capabilities,
    unsupported,
    kernelVersion: '6.6.0',
    providerVersion: '1.0.0',
  }
}

export function validateConfig(config: IsolationConfig): IsolationResult {
  const attestation = probeCapabilities(config.platform)
  const errors: string[] = []

  switch (config.platform) {
    case 'linux':
      if (!config.seccompFilter) errors.push('seccompFilter required on Linux')
      if (!config.restrictDockerSocket) errors.push('Docker socket must be restricted')
      if (!config.restrictSSHAgent) errors.push('SSH agent must be restricted')
      break
    case 'macos':
      if (!config.restrictClipboard) errors.push('Clipboard must be restricted on macOS')
      if (!config.restrictCamera) errors.push('Camera must be restricted')
      break
    case 'windows':
      if (!config.restrictDevices) errors.push('Device access must be restricted')
      if (!config.restrictIPC) errors.push('IPC must be restricted')
      break
  }

  return { success: errors.length === 0, attestation, errors }
}

export function isFailClosed(attestation: IsolationAttestation): boolean {
  return attestation.level !== 'none'
}
