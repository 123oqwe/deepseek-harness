import type { IsolationConfig, IsolationAttestation, IsolationResult } from './types.ts'
import { probeLinuxCapabilities, validateLinuxIsolation } from './linux.ts'
import { probeMacOSCapabilities, validateMacOSIsolation } from './macos.ts'
import { probeWindowsCapabilities, validateWindowsIsolation } from './windows.ts'

export type { IsolationConfig, IsolationAttestation, IsolationResult, Platform, IsolationLevel } from './types.ts'
export { probeLinuxCapabilities, validateLinuxIsolation } from './linux.ts'
export { probeMacOSCapabilities, validateMacOSIsolation } from './macos.ts'
export { probeWindowsCapabilities, validateWindowsIsolation } from './windows.ts'

export function probeIsolation(platform: 'linux' | 'macos' | 'windows'): IsolationAttestation {
  switch (platform) {
    case 'linux': return probeLinuxCapabilities()
    case 'macos': return probeMacOSCapabilities()
    case 'windows': return probeWindowsCapabilities()
  }
}

export function validateIsolation(config: IsolationConfig): IsolationResult {
  const attestation = probeIsolation(config.platform)
  let validation: { valid: boolean; errors: string[] }

  switch (config.platform) {
    case 'linux': validation = validateLinuxIsolation(config); break
    case 'macos': validation = validateMacOSIsolation(config); break
    case 'windows': validation = validateWindowsIsolation(config); break
  }

  return {
    success: validation.valid,
    attestation,
    errors: validation.errors,
  }
}
