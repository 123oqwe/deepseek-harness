import type { IsolationConfig, IsolationAttestation } from './types.ts'

export function probeWindowsCapabilities(): IsolationAttestation {
  const capabilities: string[] = ['restricted-token', 'job-object', 'acl']
  const unsupported: string[] = []

  unsupported.push('user-namespace', 'pid-namespace', 'seccomp', 'landlock')

  const level = 'basic' as const

  return {
    platform: 'windows',
    level,
    capabilities,
    unsupported,
    kernelVersion: '10.0.22631',
    providerVersion: '1.0.0',
  }
}

export function validateWindowsIsolation(config: IsolationConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!config.restrictDevices) errors.push('Device access must be restricted')
  if (!config.restrictIPC) errors.push('IPC must be restricted')
  if (!config.restrictClipboard) errors.push('Clipboard must be restricted')
  return { valid: errors.length === 0, errors }
}
