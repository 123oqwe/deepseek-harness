import type { DestinationPolicy, EgressRequest, EgressDecision } from './types.ts'
import { resolveDns, isPrivateIp, isLoopbackIp } from './dns.ts'

export function evaluateEgress(
  request: EgressRequest,
  policy: DestinationPolicy,
): EgressDecision {
  let hostname: string
  try {
    hostname = new URL(request.url).hostname
  } catch {
    return { allowed: false, reason: 'Invalid URL' }
  }

  // Check explicit blocklist first
  if (policy.blocked.some(pattern => matchHost(hostname, pattern))) {
    return { allowed: false, reason: `Host ${hostname} is blocked` }
  }

  // SSRF check: resolve DNS and check for private/loopback IPs
  const resolution = resolveDns(hostname)
  for (const ip of resolution.addresses) {
    if (!policy.allowPrivateIPs && isPrivateIp(ip)) {
      return { allowed: false, reason: `SSRF blocked: ${hostname} resolves to private IP ${ip}` }
    }
    if (!policy.allowLoopback && isLoopbackIp(ip)) {
      return { allowed: false, reason: `SSRF blocked: ${hostname} resolves to loopback ${ip}` }
    }
  }

  // Check explicit allowlist
  const isExplicitlyAllowed = policy.allowed.some(pattern => matchHost(hostname, pattern))
  if (policy.allowed.length > 0 && !isExplicitlyAllowed && !policy.allowed.includes('*')) {
    return { allowed: false, reason: `Host ${hostname} not in allowlist` }
  }

  return { allowed: true, reason: 'allowed', resolvedIp: resolution.addresses[0] }
}

function matchHost(hostname: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern === hostname) return true
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    return hostname.endsWith('.' + suffix) || hostname === suffix
  }
  return false
}
