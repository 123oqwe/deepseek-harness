export interface ContainerImage {
  readonly digest: string
  readonly tag: string
  readonly rootless: boolean
  readonly readOnlyRootfs: boolean
}

export interface ContainerSpec {
  readonly image: ContainerImage
  readonly ephemeralOverlay: boolean
  readonly egressProxy: boolean
  readonly secretLeases: readonly string[]
  readonly resourceQuotas: { readonly cpu: string; readonly memory: string }
  readonly mountDockerSocket: boolean
  readonly mountHostHome: boolean
}

export interface ContainerHandle {
  readonly id: string
  readonly spec: ContainerSpec
  readonly createdAt: number
  readonly status: 'running' | 'stopped' | 'crashed'
}

export interface ContainerAttestation {
  readonly imageDigest: string
  readonly rootless: boolean
  readonly readOnlyRootfs: boolean
  readonly noDockerSocket: boolean
  readonly noHostHome: boolean
  readonly egressProxyEnabled: boolean
}
