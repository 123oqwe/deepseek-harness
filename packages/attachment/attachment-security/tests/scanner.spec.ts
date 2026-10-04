/**
 * The attachment-security scanner refuses each threat class P3-12 must[1] names
 * and admits a benign payload, both as the pure {@link scanPayload} and through
 * the mounted {@link AttachmentSecurityScanner} service, and removes
 * `ctx.attachmentScanner` when its fiber disposes.
 * @module @deepseek-ai/dsh-attachment-security/tests/scanner
 */

import { Context } from '@deepseek-ai/cordis'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { AttachmentScanInput, AttachmentScanVerdict, AttachmentThreatKind } from '@deepseek-ai/dsh-attachment'
import { AttachmentScanner } from '@deepseek-ai/dsh-attachment'
import AttachmentSecurityScanner, { scanPayload } from '../src/index.ts'
import type { ScanPolicy } from '../src/index.ts'

const POLICY: ScanPolicy = { maxDecompressionRatio: 100, maxNestingDepth: 1, maxPixels: 64_000_000 }

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A minimal PNG whose IHDR declares the given dimensions. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set(PNG_SIG, 0)
  bytes.set([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52], 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function input(bytes: Uint8Array, declaredMediaType: string): AttachmentScanInput {
  return { bytes, declaredMediaType }
}

function refusalKind(verdict: AttachmentScanVerdict): AttachmentThreatKind | 'admit' {
  return verdict.admit ? 'admit' : verdict.refusal.kind
}

describe('scanPayload (P3-12 must[1]): each threat class refuses, a benign payload admits', () => {
  it('admits a small well-formed PNG', () => {
    expect(scanPayload(input(png(1, 1), 'image/png'), POLICY)).toBeUndefined()
  })

  it('refuses a declared-vs-sniffed media-type mismatch', () => {
    const zip = zipSync({ 'a.txt': new Uint8Array(4) })
    expect(scanPayload(input(zip, 'image/png'), POLICY)?.kind).toBe('mime-mismatch')
  })

  it('refuses a native executable whatever it is declared', () => {
    expect(scanPayload(input(Uint8Array.from([0x4d, 0x5a, 0, 0, 0, 0]), 'application/octet-stream'), POLICY)?.kind).toBe('executable')
  })

  it('refuses an OLE compound (macro-bearing) document', () => {
    const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0])
    expect(scanPayload(input(ole, 'application/msword'), POLICY)?.kind).toBe('macro')
  })

  it('refuses a pixel bomb', () => {
    expect(scanPayload(input(png(0xffff, 0xffff), 'image/png'), POLICY)?.kind).toBe('pixel-bomb')
  })

  it('refuses an image carrying an embedded ZIP (polyglot)', () => {
    const poly = new Uint8Array(28)
    poly.set(png(1, 1), 0)
    poly.set([0x50, 0x4b, 0x03, 0x04], 24)
    expect(scanPayload(input(poly, 'image/png'), POLICY)?.kind).toBe('polyglot')
  })

  it('refuses an over-ratio decompression (zip bomb)', () => {
    const bomb = zipSync({ z: new Uint8Array(200_000) }, { level: 9 })
    expect(scanPayload(input(bomb, 'application/zip'), POLICY)?.kind).toBe('decompression-ratio')
  })

  it('refuses an OOXML archive carrying a macro project', () => {
    const docx = zipSync({ 'word/vbaProject.bin': new Uint8Array(4), 'word/document.xml': new Uint8Array(4) })
    const ooxml = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    expect(scanPayload(input(docx, ooxml), POLICY)?.kind).toBe('macro')
  })

  it('refuses archive nesting past the depth limit', () => {
    const nested = zipSync({ 'inner.zip': zipSync({ 'a.txt': new Uint8Array(4) }) })
    expect(scanPayload(input(nested, 'application/zip'), { ...POLICY, maxNestingDepth: 0 })?.kind).toBe('nesting-depth')
  })

  it('admits a single nested archive within the depth limit', () => {
    const nested = zipSync({ 'inner.zip': zipSync({ 'a.txt': new Uint8Array(4) }) })
    expect(scanPayload(input(nested, 'application/zip'), POLICY)).toBeUndefined()
  })
})

/** A scanner that admits everything, for the shared contract check. */
class AdmitAllScanner extends AttachmentScanner {
  scan(): Promise<AttachmentScanVerdict> {
    return Promise.resolve({ admit: true })
  }
}

describe('AttachmentScanner conformance: the verdict is well-formed for every provider', () => {
  it.each([
    ['admit-all fake', new AdmitAllScanner(new Context())],
    ['attachment-security', new AttachmentSecurityScanner(new Context(), {})],
  ])('%s returns a verdict whose refusal (if any) carries a kind and detail', async (_label, scanner) => {
    const verdict = await scanner.scan(input(png(0xffff, 0xffff), 'image/png'))
    expect(typeof verdict.admit).toBe('boolean')
    if (!verdict.admit) {
      expect(typeof verdict.refusal.kind).toBe('string')
      expect(typeof verdict.refusal.detail).toBe('string')
    }
  })
})

describe('AttachmentSecurityScanner service', () => {
  it('publishes ctx.attachmentScanner that refuses a threat', async () => {
    const ctx = new Context()
    await ctx.plugin(AttachmentSecurityScanner, {})
    expect(refusalKind(await ctx.attachmentScanner!.scan(input(Uint8Array.from([0x7f, 0x45, 0x4c, 0x46]), 'x')))).toBe('executable')
  })

  it('removes ctx.attachmentScanner when the providing fiber disposes (HMR safety)', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(AttachmentSecurityScanner, {})
    expect(ctx.get('attachmentScanner')).toBeInstanceOf(AttachmentSecurityScanner)
    await fiber.dispose()
    expect(ctx.get('attachmentScanner')).toBeUndefined()
  })
})
