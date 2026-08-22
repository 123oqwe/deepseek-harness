export type HostMessageType = 'call' | 'result' | 'error' | 'heartbeat' | 'crash' | 'policy-check'

export interface HostRequest {
  readonly id: string
  readonly type: HostMessageType
  readonly method: string
  readonly args: unknown[]
  readonly capabilityToken?: string
}

export interface HostResponse {
  readonly id: string
  readonly ok: boolean
  readonly result?: unknown
  readonly error?: { code: string; message: string }
  readonly deniedBy?: string
}

export interface HostCrash {
  readonly processId: string
  readonly reason: string
  readonly timestamp: string
}

export interface PluginHostConfig {
  readonly pluginId: string
  readonly maxMemory: number
  readonly maxCpu: number
  readonly timeout: number
  readonly isolated: boolean
}
