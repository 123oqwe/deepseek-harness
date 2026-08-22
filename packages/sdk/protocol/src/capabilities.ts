/**
 * Capability discovery for the SDK runtime protocol.
 *
 * @module @deepseek-ai/dsh-sdk-protocol/capabilities
 */

export interface ServerCapability {
  readonly name: string
  readonly version: string
  readonly optional: boolean
}

export interface CapabilityDiscoveryResult {
  readonly serverName: string
  readonly serverVersion: string
  readonly capabilities: ServerCapability[]
  readonly protocolVersion: string
}

export function discoverCapabilities(serverName: string, serverVersion: string, caps: ServerCapability[]): CapabilityDiscoveryResult {
  return {
    serverName,
    serverVersion,
    capabilities: caps,
    protocolVersion: '0.1',
  }
}

export function hasCapability(result: CapabilityDiscoveryResult, name: string): boolean {
  return result.capabilities.some(c => c.name === name)
}

export function getCapability(result: CapabilityDiscoveryResult, name: string): ServerCapability | undefined {
  return result.capabilities.find(c => c.name === name)
}
