export interface LockedDependency {
  readonly name: string
  readonly version: string
  readonly resolved: string
  readonly integrity: string
  readonly optional: boolean
}

export interface PluginLockFile {
  readonly version: number
  readonly plugins: Record<string, { readonly version: string; readonly dependencies: LockedDependency[] }>
  readonly generatedAt: string
  readonly hashAlgorithm: string
}
