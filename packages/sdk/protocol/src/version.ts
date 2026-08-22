/**
 * Protocol version negotiation for the SDK runtime protocol.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/version
 */

export interface ProtocolVersion {
  readonly major: number
  readonly minor: number
}

export interface VersionNegotiationResult {
  readonly agreed: boolean
  readonly agreedVersion?: ProtocolVersion
  readonly reason: string
}

const SUPPORTED_VERSIONS: ProtocolVersion[] = [
  { major: 0, minor: 1 },
]

export function getSupportedVersions(): ProtocolVersion[] {
  return [...SUPPORTED_VERSIONS]
}

export function isSupported(version: ProtocolVersion): boolean {
  return SUPPORTED_VERSIONS.some(v => v.major === version.major && v.minor === version.minor)
}

export function negotiate(clientVersion: ProtocolVersion, serverVersions: ProtocolVersion[]): VersionNegotiationResult {
  for (const sv of serverVersions) {
    if (sv.major === clientVersion.major && sv.minor === clientVersion.minor) {
      return { agreed: true, agreedVersion: clientVersion, reason: 'exact match' }
    }
  }

  for (const sv of serverVersions) {
    if (sv.major === clientVersion.major && sv.minor >= clientVersion.minor) {
      return { agreed: true, agreedVersion: sv, reason: `backward compatible within major ${sv.major}` }
    }
  }

  return { agreed: false, reason: `no compatible version found for client v${clientVersion.major}.${clientVersion.minor}` }
}

export function compareVersions(a: ProtocolVersion, b: ProtocolVersion): number {
  if (a.major !== b.major) return a.major - b.major
  return a.minor - b.minor
}

export function formatVersion(v: ProtocolVersion): string {
  return `v${v.major}.${v.minor}`
}
