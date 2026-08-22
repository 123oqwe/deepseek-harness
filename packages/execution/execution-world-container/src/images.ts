import { createHash } from 'node:crypto'
import type { ContainerImage } from './types.ts'

export function verifyImageDigest(image: ContainerImage): { valid: boolean; reason: string } {
  if (!image.digest) return { valid: false, reason: 'Missing image digest' }
  if (!image.digest.match(/^[a-z0-9]+:[a-f0-9]{32,64}$/)) {
    return { valid: false, reason: 'Invalid digest format' }
  }
  return { valid: true, reason: 'valid' }
}

export function computeReproducibilityHash(image: ContainerImage, inputs: readonly string[]): string {
  const content = JSON.stringify({ image, inputs })
  return createHash('sha256').update(content).digest('hex')
}

export function compareImages(a: ContainerImage, b: ContainerImage): boolean {
  return a.digest === b.digest && a.tag === b.tag
}
