import type { DnsResolution } from './types.ts'

export function resolveDns(hostname: string, mockAddresses?: string[]): DnsResolution {
  // In production, this would use actual DNS resolution
  // For testing, we use mock addresses or well-known ranges
  const addresses = mockAddresses ?? mockResolve(hostname)
  const isPrivate = addresses.some(ip => isPrivateIp(ip))
  const isLoopback = addresses.some(ip => isLoopbackIp(ip))
  return { hostname, addresses, isPrivate, isLoopback }
}

function mockResolve(hostname: string): string[] {
  // Simulate DNS resolution for known hostnames
  if (hostname === 'localhost' || hostname === '127.0.0.1') return ['127.0.0.1']
  if (hostname === 'api.example.com') return ['93.184.216.34']
  if (hostname === 'internal.local') return ['10.0.0.1']
  if (hostname === 'evil.com') return ['203.0.113.1']
  // Default: public IP
  return ['192.0.2.1']
}

export function isPrivateIp(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4) return false
  // 10.0.0.0/8
  if (parts[0] === 10) return true
  // 172.16.0.0/12
  if (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) return true
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true
  // 169.254.0.0/16 (link-local)
  if (parts[0] === 169 && parts[1] === 254) return true
  return false
}

export function isLoopbackIp(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')
}
