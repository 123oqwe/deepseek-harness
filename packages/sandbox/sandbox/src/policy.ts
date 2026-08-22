export interface FileSystemPolicy {
  readonly allowedReadPaths: string[]
  readonly allowedWritePaths: string[]
  readonly denySymlinks: boolean
}

export interface NetworkPolicy {
  readonly allowedDestinations: string[]
  readonly allowedPorts: number[]
  readonly denyAllNetwork: boolean
}

export interface ProcessPolicy {
  readonly allowedCommands: string[]
  readonly allowShell: boolean
  readonly maxProcesses: number
}

export interface IpcPolicy {
  readonly allowedNamespaces: string[]
  readonly denyAll: boolean
}

export interface DevicePolicy {
  readonly allowedDevices: string[]
  readonly denyAll: boolean
}

export interface SecretPolicy {
  readonly allowedSecrets: string[]
  readonly denyAll: boolean
}

export interface ResourcePolicy {
  readonly maxCpuPercent: number
  readonly maxMemoryMB: number
  readonly maxDiskMB: number
  readonly maxWallTimeSeconds: number
}

export interface SandboxPolicy {
  readonly fs: FileSystemPolicy
  readonly net: NetworkPolicy
  readonly proc: ProcessPolicy
  readonly ipc: IpcPolicy
  readonly device: DevicePolicy
  readonly secret: SecretPolicy
  readonly resource: ResourcePolicy
}

export const DEFAULT_DENY_POLICY: SandboxPolicy = {
  fs: { allowedReadPaths: [], allowedWritePaths: [], denySymlinks: true },
  net: { allowedDestinations: [], allowedPorts: [], denyAllNetwork: true },
  proc: { allowedCommands: [], allowShell: false, maxProcesses: 0 },
  ipc: { allowedNamespaces: [], denyAll: true },
  device: { allowedDevices: [], denyAll: true },
  secret: { allowedSecrets: [], denyAll: true },
  resource: { maxCpuPercent: 0, maxMemoryMB: 0, maxDiskMB: 0, maxWallTimeSeconds: 0 },
}

export function checkFsAccess(policy: SandboxPolicy, path: string, mode: 'read' | 'write'): boolean {
  const list = mode === 'read' ? policy.fs.allowedReadPaths : policy.fs.allowedWritePaths
  return list.some(p => path.startsWith(p))
}

export function checkNetworkAccess(policy: SandboxPolicy, destination: string, port: number): boolean {
  if (policy.net.denyAllNetwork) return false
  if (!policy.net.allowedDestinations.includes(destination)) return false
  if (policy.net.allowedPorts.length > 0 && !policy.net.allowedPorts.includes(port)) return false
  return true
}

export function checkProcessAccess(policy: SandboxPolicy, command: string): boolean {
  if (!policy.proc.allowShell && command.includes('&&')) return false
  return policy.proc.allowedCommands.includes(command)
}

export function checkSecretAccess(policy: SandboxPolicy, secretName: string): boolean {
  if (policy.secret.denyAll) return false
  return policy.secret.allowedSecrets.includes(secretName)
}
