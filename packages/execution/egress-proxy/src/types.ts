export interface DestinationPolicy {
  readonly allowed: readonly string[]
  readonly blocked: readonly string[]
  readonly allowPrivateIPs: boolean
  readonly allowLoopback: boolean
  readonly dnsServers: readonly string[]
}

export interface EgressRequest {
  readonly url: string
  readonly method: string
  readonly principal: string
  readonly actionManifestDigest: string
}

export interface EgressDecision {
  readonly allowed: boolean
  readonly reason: string
  readonly resolvedIp?: string
  readonly redirectedTo?: string
}

export interface DnsResolution {
  readonly hostname: string
  readonly addresses: readonly string[]
  readonly isPrivate: boolean
  readonly isLoopback: boolean
}
