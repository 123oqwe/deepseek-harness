import { describe, it, expect } from 'vitest'
import { evaluateEgress, isPrivateIp, isLoopbackIp } from '../src/index.ts'

const defaultPolicy = {
  allowed: ['api.example.com'],
  blocked: ['evil.com'],
  allowPrivateIPs: false,
  allowLoopback: false,
  dnsServers: ['8.8.8.8'],
}

describe('P3-04 Egress Proxy', () => {
  it('allows explicitly allowed host', () => {
    const result = evaluateEgress(
      { url: 'https://api.example.com/v1', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      defaultPolicy,
    )
    expect(result.allowed).toBe(true)
  })

  it('blocks explicitly blocked host', () => {
    const result = evaluateEgress(
      { url: 'https://evil.com/exfil', method: 'POST', principal: 'user', actionManifestDigest: 'abc' },
      defaultPolicy,
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('blocked')
  })

  it('blocks host not in allowlist', () => {
    const result = evaluateEgress(
      { url: 'https://unknown.com/data', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      defaultPolicy,
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('allowlist')
  })

  it('blocks SSRF to private IP', () => {
    const result = evaluateEgress(
      { url: 'https://internal.local/secret', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      defaultPolicy,
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('SSRF')
  })

  it('blocks SSRF to loopback', () => {
    const result = evaluateEgress(
      { url: 'https://localhost:8080/admin', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      defaultPolicy,
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('SSRF')
  })

  it('allows private IPs when policy permits', () => {
    const policy = { ...defaultPolicy, allowed: ['*'], allowPrivateIPs: true }
    const result = evaluateEgress(
      { url: 'https://internal.local/secret', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      policy,
    )
    expect(result.allowed).toBe(true)
  })

  it('rejects invalid URL', () => {
    const result = evaluateEgress(
      { url: 'not-a-url', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      defaultPolicy,
    )
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('Invalid')
  })

  it('wildcard allowlist allows all non-blocked', () => {
    const policy = { ...defaultPolicy, allowed: ['*'] }
    const result = evaluateEgress(
      { url: 'https://anyhost.com/path', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      policy,
    )
    expect(result.allowed).toBe(true)
  })

  it('detects private IP ranges', () => {
    expect(isPrivateIp('10.0.0.1')).toBe(true)
    expect(isPrivateIp('172.16.0.1')).toBe(true)
    expect(isPrivateIp('192.168.1.1')).toBe(true)
    expect(isPrivateIp('8.8.8.8')).toBe(false)
  })

  it('detects loopback IPs', () => {
    expect(isLoopbackIp('127.0.0.1')).toBe(true)
    expect(isLoopbackIp('127.0.1.1')).toBe(true)
    expect(isLoopbackIp('::1')).toBe(true)
    expect(isLoopbackIp('8.8.8.8')).toBe(false)
  })

  it('blocks wildcard subdomain pattern', () => {
    const policy = { ...defaultPolicy, allowed: ['*.example.com'] }
    const ok = evaluateEgress(
      { url: 'https://api.example.com/path', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      policy,
    )
    expect(ok.allowed).toBe(true)
    const blocked = evaluateEgress(
      { url: 'https://api.other.com/path', method: 'GET', principal: 'user', actionManifestDigest: 'abc' },
      policy,
    )
    expect(blocked.allowed).toBe(false)
  })
})
