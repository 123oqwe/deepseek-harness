/**
 * P3-12 must[2] red first, the lineage half: 「未信任附件只在隔离 world 解析，解析产物带 lineage。」
 *
 * An image enters through the shipped admission entry every upload endpoint
 * shares, `admitEncodedImages`, over the shipped local provider
 * (`LocalAttachmentStore`): `saveImages` → `commitImages` → `prepareImageFile`.
 * What the provider stores is a normalized product of the submitted bytes, so
 * its reference must name the source it was derived from. Each case reads the
 * reference's `sourceAttachmentId` and requires that it names the sha256 of
 * the exact submitted bytes, and not the sha256 of the stored product.
 *
 * The store caps the normalized image at 16 px on the long edge, so the 32×32
 * source is downscaled and the stored bytes differ from the submitted ones; a
 * guard checks that this happened, or the source and the product would be the
 * same bytes and the case could not tell them apart.
 *
 * Written blind for lane A's sub-slice B (5820f6dbd3, not read), on S5′
 * 9f06a87ee3 (§21.4). The field is read through `unknown`, so the file
 * compiles before and after the type gains it.
 * @module tests/first100/fixtures/P3-12.must2-lineage.provider
 */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import { afterEach, describe, expect, it } from 'vitest'

/** A 32×32 opaque PNG, downscaled by the 16 px cap below. */
const PNG_32 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAO0lEQVRIiWPgUbKgKWIYtUBpNIgsRlMRz2hGsxgtKnhGS1Ol0QqHZ7TKVBptVViMNryURpuOFoO6dQ0AbQeYEIeTlWUAAAAASUVORK5CYII=',
  'base64',
))

/** A 1×1 PNG, a second source distinct from {@link PNG_32}. */
const PNG_1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
))

const created: string[] = []

afterEach(async () => {
  await Promise.all(created.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

/**
 * The shipped local provider over a fresh `DSH_HOME`, with the stored image capped at 16 px.
 * @returns the provider.
 */
async function freshStore(): Promise<LocalAttachmentStore> {
  const dshHome = await mkdtemp(join(tmpdir(), 'p3-12-must2-lineage-'))
  created.push(dshHome)
  return new LocalAttachmentStore(new Context(), { dshHome, normalizedImageMaxDimension: 16 })
}

/**
 * The lowercase hex sha256 of `bytes`.
 * @param bytes - the bytes to digest.
 * @returns the hex digest.
 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * The reference's source lineage field, read without relying on the type declaring it.
 * @param ref - a reference the provider returned.
 * @returns the field's value.
 */
function sourceOf(ref: object): unknown {
  return (ref as { readonly sourceAttachmentId?: unknown }).sourceAttachmentId
}

/**
 * Admit one PNG through the shipped admission entry.
 * @param store - the provider.
 * @param bytes - the PNG bytes.
 * @returns the durable reference.
 */
async function admit(store: LocalAttachmentStore, bytes: Uint8Array) {
  const [ref] = await admitEncodedImages(store, [{ mediaType: 'image/png', data: Buffer.from(bytes).toString('base64') }])
  if (ref === undefined) throw new Error('admission returned no reference')
  return ref
}

describe('P3-12 must[2]: a stored image product carries the lineage of the bytes it was derived from', () => {
  it('a downscaled image\'s reference names the sha256 of the exact submitted bytes, not of the stored product', async () => {
    const store = await freshStore()
    const ref = await admit(store, PNG_32)
    // Guard: normalization changed the bytes, so source and product are distinguishable.
    expect(ref.originalDimensions).toEqual({ width: 32, height: 32 })
    const productHex = ref.attachmentId.replace(/^sha256:/u, '')
    expect(productHex).not.toBe(sha256Hex(PNG_32))

    const source = sourceOf(ref)
    expect(typeof source, 'the reference carries no source lineage').toBe('string')
    expect(String(source)).toContain(sha256Hex(PNG_32))
    expect(String(source)).not.toContain(productHex)
  })

  it('each source keeps its own lineage, and the same submitted bytes give the same source id', async () => {
    const store = await freshStore()
    const first = await admit(store, PNG_32)
    const again = await admit(store, PNG_32)
    const other = await admit(store, PNG_1)

    expect(typeof sourceOf(first), 'the reference carries no source lineage').toBe('string')
    expect(String(sourceOf(first))).toContain(sha256Hex(PNG_32))
    expect(String(sourceOf(other))).toContain(sha256Hex(PNG_1))
    expect(sourceOf(again)).toBe(sourceOf(first))
    expect(sourceOf(other)).not.toBe(sourceOf(first))
  })
})
