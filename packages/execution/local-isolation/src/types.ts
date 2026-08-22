export type Platform = 'linux' | 'macos' | 'windows'
export type IsolationLevel = 'none' | 'basic' | 'strict'

export interface IsolationConfig {
  readonly platform: Platform
  readonly userNamespace: boolean
  readonly pidNamespace: boolean
  readonly networkNamespace: boolean
  readonly mountNamespace: boolean
  readonly seccompFilter: boolean
  readonly restrictDevices: boolean
  readonly restrictIPC: boolean
  readonly restrictClipboard: boolean
  readonly restrictCamera: boolean
  readonly restrictGPU: boolean
  readonly restrictDockerSocket: boolean
  readonly restrictSSHAgent: boolean
}

export interface IsolationAttestation {
  readonly platform: Platform
  readonly level: IsolationLevel
  readonly capabilities: readonly string[]
  readonly unsupported: readonly string[]
  readonly kernelVersion: string
  readonly providerVersion: string
}

export interface IsolationResult {
  readonly success: boolean
  readonly attestation: IsolationAttestation
  readonly errors: readonly string[]
}
