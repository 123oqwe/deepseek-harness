export type WorldKind = 'local' | 'container' | 'microvm' | 'remote' | 'browser'
export type WorldState = 'uninitialized' | 'created' | 'running' | 'frozen' | 'destroyed'

export interface FSAccess { readonly read: string[]; readonly write: string[] }
export interface NetAccess { readonly allowDestinations: string[]; readonly allowPorts?: number[] }
export interface ProcAccess { readonly allowCommands: string[]; readonly allowShell: boolean }
export interface IPCAccess { readonly allowNamespaces: string[] }
export interface DeviceAccess { readonly allowDevices: string[] }

export interface WorldPolicy {
  readonly fs: FSAccess
  readonly net: NetAccess
  readonly proc: ProcAccess
  readonly ipc: IPCAccess
  readonly device: DeviceAccess
}

export interface ExecutionWorld {
  readonly id: string
  readonly kind: WorldKind
  readonly state: WorldState
  readonly policy: WorldPolicy
  readonly createdAt: string
}
