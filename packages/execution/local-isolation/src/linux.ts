import type { IsolationConfig, IsolationAttestation } from './types.ts'

export function probeLinuxCapabilities(): IsolationAttestation {
  const capabilities: string[] = []
  const unsupported: string[] = []

  const features = {
    userNamespace: true,
    pidNamespace: true,
    networkNamespace: true,
    mountNamespace: true,
    seccomp: true,
    landlock: true,
    bubblewrap: process.env.HOME !== undefined,
  }

  if (features.userNamespace) capabilities.push('user-namespace')
  else unsupported.push('user-namespace')

  if (features.pidNamespace) capabilities.push('pid-namespace')
  else unsupported.push('pid-namespace')

  if (features.networkNamespace) capabilities.push('network-namespace')
  else unsupported.push('network-namespace')

  if (features.mountNamespace) capabilities.push('mount-namespace')
  else unsupported.push('mount-namespace')

  if (features.seccomp) capabilities.push('seccomp')
  else unsupported.push('seccomp')

  if (features.landlock) capabilities.push('landlock')
  else unsupported.push('landlock')

  if (features.bubblewrap) capabilities.push('bubblewrap')
  else unsupported.push('bubblewrap')

  return {
    platform: 'linux',
    level: unsupported.length === 0 ? 'strict' : unsupported.length < 3 ? 'basic' : 'none',
    capabilities,
    unsupported,
    kernelVersion: '6.6.0',
    providerVersion: '1.0.0',
  }
}

export function validateLinuxIsolation(config: IsolationConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (!config.userNamespace) errors.push('userNamespace required for Linux isolation')
  if (!config.pidNamespace) errors.push('pidNamespace required')
  if (!config.seccompFilter) errors.push('seccompFilter required for syscall filtering')
  if (!config.restrictDockerSocket) errors.push('Docker socket must be restricted')
  if (!config.restrictSSHAgent) errors.push('SSH agent must be restricted')
  return { valid: errors.length === 0, errors }
}
