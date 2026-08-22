export type { DestinationPolicy, EgressRequest, EgressDecision, DnsResolution } from './types.ts'
export { evaluateEgress } from './policy.ts'
export { resolveDns, isPrivateIp, isLoopbackIp } from './dns.ts'
