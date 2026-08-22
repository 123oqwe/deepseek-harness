import type { IsolationConfig, IsolationAttestation } from './types.ts'

export function probeMacOSCapabilities(): IsolationAttestation {
  const capabilities: string[] = ['seatbelt']
  const unsupported: string[] = []

  // Seatbelt (sandboxd) is the primary macOS isolation mechanism
  // No user/pid/network namespaces on macOS
  unsupported.push('user-namespace', 'pid-namespace', 'network-namespace', 'seccomp')

  const level = 'basic' as const

  return {
    platform: 'macos',
    level,
    capabilities,
    unsupported,
    kernelVersion: '24.0.0',
    providerVersion: '1.0.0',
  }
}

export function validateMacOSIsolation(config: IsolationConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  // macOS uses Seatbelt, not namespaces
  // But still requires device restrictions
  if (!config.restrictClipboard) errors.push('Clipboard must be restricted')
  if (!config.restrictCamera) errors.push('Camera must be restricted')
  if (!config.restrictDockerSocket) errors.push('Docker socket must be restricted')
  return { valid: errors.length === 0, errors }
}
