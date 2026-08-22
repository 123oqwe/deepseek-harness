import { describe, it, expect } from 'vitest'
import { detectPathTraversal, sniffMimeType, detectCompressionBomb, scanAttachment } from '../src/index.ts'

describe('P3-12 Attachment Security', () => {
  it('detects path traversal', () => {
    expect(detectPathTraversal('../../etc/passwd')).toBe(true)
    expect(detectPathTraversal('/workspace/safe')).toBe(false)
  })

  it('sniffs PNG MIME type', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffMimeType(png)).toBe('image/png')
  })

  it('sniffs ZIP MIME type', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04])
    expect(sniffMimeType(zip)).toBe('application/zip')
  })

  it('detects compression bomb', () => {
    expect(detectCompressionBomb(1024, 200000)).toBe(true)
    expect(detectCompressionBomb(1024, 5000)).toBe(false)
  })

  it('scanAttachment detects MIME mismatch', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    const result = scanAttachment(png, 'text/plain')
    expect(result.safe).toBe(false)
    expect(result.threats.some(t => t.includes('MIME mismatch'))).toBe(true)
  })

  it('scanAttachment detects executable', () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00])
    const result = scanAttachment(exe)
    expect(result.safe).toBe(false)
    expect(result.threats.some(t => t.includes('executable'))).toBe(true)
  })

  it('scanAttachment passes for safe PNG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const result = scanAttachment(png, 'image/png')
    expect(result.safe).toBe(true)
  })
})
