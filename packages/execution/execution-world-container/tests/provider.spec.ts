import { describe, it, expect } from 'vitest'
import { ContainerRuntime, verifyImageDigest, computeReproducibilityHash } from '../src/index.ts'

const validImage = {
  digest: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  tag: 'v1.0',
  rootless: true,
  readOnlyRootfs: true,
}

const validSpec = {
  image: validImage,
  ephemeralOverlay: true,
  egressProxy: true,
  secretLeases: ['lease-1'],
  resourceQuotas: { cpu: '2', memory: '4Gi' },
  mountDockerSocket: false,
  mountHostHome: false,
}

describe('P3-08 Container ExecutionWorld Provider', () => {
  it('creates container from valid spec', () => {
    const rt = new ContainerRuntime()
    const result = rt.create(validSpec)
    expect(result.handle).toBeDefined()
    expect(result.handle?.status).toBe('running')
  })

  it('rejects invalid image digest', () => {
    const rt = new ContainerRuntime()
    const result = rt.create({ ...validSpec, image: { ...validImage, digest: 'invalid' } })
    expect(result.error).toBeDefined()
  })

  it('rejects Docker socket mount', () => {
    const rt = new ContainerRuntime()
    const result = rt.create({ ...validSpec, mountDockerSocket: true })
    expect(result.error).toContain('Docker socket')
  })

  it('rejects host home mount', () => {
    const rt = new ContainerRuntime()
    const result = rt.create({ ...validSpec, mountHostHome: true })
    expect(result.error).toContain('Host home')
  })

  it('attests container properties', () => {
    const rt = new ContainerRuntime()
    const { handle } = rt.create(validSpec)
    const att = rt.attest(handle!.id)
    expect(att?.noDockerSocket).toBe(true)
    expect(att?.rootless).toBe(true)
  })

  it('terminates container', () => {
    const rt = new ContainerRuntime()
    const { handle } = rt.create(validSpec)
    const result = rt.terminate(handle!.id)
    expect(result.terminated).toBe(true)
  })

  it('cleanup removes all containers', () => {
    const rt = new ContainerRuntime()
    rt.create(validSpec)
    rt.create(validSpec)
    const result = rt.cleanup()
    expect(result.removed).toBe(2)
  })

  it('verifies image digest format', () => {
    expect(verifyImageDigest(validImage).valid).toBe(true)
    expect(verifyImageDigest({ ...validImage, digest: 'bad' }).valid).toBe(false)
  })

  it('computes reproducibility hash', () => {
    const h1 = computeReproducibilityHash(validImage, ['input1'])
    const h2 = computeReproducibilityHash(validImage, ['input1'])
    expect(h1).toBe(h2)
  })
})
